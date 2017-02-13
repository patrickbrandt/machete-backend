'use strict';

process.env['PATH'] = `${process.env['PATH']}:${process.env['LAMBDA_TASK_ROOT']}:${process.env['LAMBDA_TASK_ROOT']}/functions/ripVine`;
const AWS = require('aws-sdk');
const async = require('async');
const https = require('https');
const fs = require('fs');
const ffmpeg = require('ffmpeg');
const im = require('gm').subClass({imageMagick: true});
const rimraf = require('rimraf');

const framesDirectory = '/tmp/frames';
const s3bucket = process.env.MACHETE_BUCKET;
const columns = 10;
const size = 300;

module.exports = (event, context, callback) => {
  console.log(`recieved event: ${JSON.stringify(event)}`);
  //event -->
  //progressTopic
  //vine_url
  const progressTopic = event.progressTopic;
  const vine_id = getVineId(event.vine_url);
  let frames = 0;
  async.waterfall([
    function cleanTmpDirectory(next) {
      //NOTE: the ffmpeg->video.save function in separateAudio (below) will timeout when it encounters an existing file
      // thus, I'm cleaning up all files and directories at the start
      //TODO: experiment with this in Bash to figure out why timeout is happening
			console.log('cleaning /tmp');
      rimraf.sync(framesDirectory);
      ['mp3', 'jpg', 'mp4'].forEach(ext => {
        try {
          fs.unlinkSync(`/tmp/${vine_id}.${ext}`);
        } catch (err) {}
      });
			next();
		},
    function getMarkup(next) {
      console.log('in getMarkup function');
      //example: https://archive.vine.co/posts/eD7EM9XZpeu.json
			https.get(`https://archive.vine.co/posts/${vine_id}.json`, response => {
				let data = '';
				response.on('data', chunk => {
					data += chunk;
				})
				.on('end', () => {
          const videoData = JSON.parse(data);
          const videoSrc = videoData.videoUrl;
					console.log(`videoSrc: ${videoSrc}`);

					//download video
					next(null, videoSrc);
				})
				.on('error', err => {
					next(err);
				});
			});
    },
    function downloadVideo(videoSrc, next) {
      console.log(`in downloadVideo function with videoSrc of ${videoSrc}`);
      publish(progressTopic, 'downloading vine').then(() => {
        https.get(videoSrc.replace('http:', 'https:'), response => {
  				const videoFileName = `/tmp/${vine_id}.mp4`;
  				const videoFile = fs.createWriteStream(videoFileName);
  	  		response.pipe(videoFile);
  	  		response.on('end', () => {
  	  			console.log(`${videoFileName} downloaded`);
  		  		next(null, videoFileName);
  	  		})
  	  		.on('error', err => {
  					next(err);
  				});
  			});
      }).catch(err => next(err));
    },
    function extractFrames(videoFileName, next) {
      fs.mkdirSync(framesDirectory);
      publish(progressTopic, 'converting video - part 1').then(() => {
        new ffmpeg(videoFileName).then(video => {
					console.log('extracting frames');
					video.setDisableAudio();
					video.addCommand('-r', 30);
					video.addCommand('-t', 6);
					video.addCommand('-q:v', 3);
					video.addCommand('-f', 'image2');
					video.addCommand('-s', `${size}x${size}`);
					video.save(`${framesDirectory}/${vine_id}_%03d.jpg`, (err, files) => {
            if (err) {
              next(err);
            } else {
				      console.log(`extracted files: ${files}`);
            	next(null, videoFileName);
            }
					});
				},
				err => {
					next(err);
				});
      }).catch(err => next(err));
    },
    function createMontage(videoFileName, next) {
      console.log('creating montage');
			frames = fs.readdirSync(framesDirectory).length;
      publish(progressTopic, 'converting video - part 2').then(() => {
        im()
          .montage(`${framesDirectory}/${vine_id}_*.jpg`)
          .tile('10x18')
          .geometry('+0+0')
          .resize(size,size)
          .write(`/tmp/${vine_id}.jpg`, error => {
            if (error) {
              next(error);
            }
            else {
            	console.log('wrote montage image');
            	next(null, videoFileName);
            }
          });
      }).catch(err => next(err));
    },
    function separateAudio(videoFileName, next) {
      publish(progressTopic, 'converting audio').then(() => {
        new ffmpeg(videoFileName).then(video => {
          const audioFileName = `/tmp/${vine_id}.mp3`;
  				console.log(`extracting audio to: ${audioFileName}`);
  				video.setAudioCodec('mp3')
  					.setAudioBitRate(128)
  					.setVideoDuration(6)
  					.setVideoFrameRate(30)
  					.setDisableVideo()
  					.save(audioFileName, (err, file) => {
  						if(err) {
  							return next(err);
  						}
  						console.log(`wrote file to: ${file}`);
              next();
  					});
  			}, err => {
  				next(err);
  			});
      });
    },
    function uploadAudioToS3(next) {
      publish(progressTopic, 'uploading audio').then(() => {
        putObject(`/tmp/${vine_id}.mp3`, `${vine_id}.mp3`, next);
      }).catch(err => next(err));
    },
    function uploadMosaicToS3(next) {
      publish(progressTopic, 'uploading video').then(() => {
        putObject(`/tmp/${vine_id}.jpg`, `${vine_id}.jpg`, next);
      }).catch(err => next(err));
    },
    function triggerComplete(next) {
      const s3url = `https://s3.amazonaws.com/${s3bucket}/${vine_id}`;
      const data = {
        'frames': frames,
        'size': size,
        'id': vine_id,
        'sprite_url': `${s3url}.jpg`,
        'audio_url': `${s3url}.mp3`
      };
      publish(progressTopic, data).then(() => {
        next();
      }).catch(err => next(err));
    },
    function done() {
      console.log('done');
    }
  ], err => {
    const message = `error processing video: ${err}`;
    console.log(message);
    publish(progressTopic, message).then(() => {});
  });
}

function getVineId(vineUrl) {
  const vineIdRegEx = /\/v\/(\w+)\/?/;
  return vineUrl.match(vineIdRegEx)[1];
}

function putObject(fileName, key, next) {
  console.log(`uploading ${fileName} to S3 key ${key}`)
	fs.readFile(fileName, (err, data) => {
		if (err) {
			return next(err);
		}
		const s3 = new AWS.S3();
		s3.putObject({ Bucket: s3bucket, Key: key, Body: new Buffer(data, 'binary') }, (err, data) => {
			if (err) {
				next(err);
			} else {
        console.log(`${fileName} uploaded to ${key}`);
				next();
			}
		});
	});
}

function publish(topic, message) {
  const iotdata = new AWS.IotData({ endpoint: process.env.IOT_ENDPOINT });
  return new Promise((resolve, reject) => {
    iotdata.publish({
        topic: topic,
        payload: JSON.stringify({ message: message }),
        qos: 1
      }, (err, data) => {
        if (err) {
          console.log(`iot error: ${err}`);
        }
        return resolve();
      });
  });
}
