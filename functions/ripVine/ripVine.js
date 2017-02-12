'use strict';
process.env['PATH'] = `${process.env['PATH']}:${process.env['LAMBDA_TASK_ROOT']}:${process.env['LAMBDA_TASK_ROOT']}/functions/ripVine`;
//process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'] + ':' + `${process.env['LAMBDA_TASK_ROOT']}/functions/ripVine`;
const AWS = require('aws-sdk');
const async = require('async');
const https = require('https');
const fs = require('fs');
const ffmpeg = require('ffmpeg');
const im = require('gm').subClass({imageMagick: true});
const rimraf = require('rimraf');

const framesDirectory = '/tmp/frames';
const spriteRowsDirectory = '/tmp/rows';
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
				.on('error', ex => {
					next(ex);
				});
			});
    },
    function downloadVideo(videoSrc, next) {

      console.log(`in downloadVideo function with videoSrc of ${videoSrc}`);

      publish(progressTopic, 'downloading vine')
        .then(() => {
          https.get(videoSrc.replace('http:', 'https:'), response => {
    				const videoFileName = `/tmp/${vine_id}.mp4`;
    				const videoFile = fs.createWriteStream(videoFileName);
    	  		response.pipe(videoFile);
    	  		response.on('end', () => {
    	  			console.log(`${videoFileName} downloaded`);
    		  		next(null, videoFileName);
    	  		})
    	  		.on('error', ex => {
    					next(ex);
    				});
    			});
        });
    },
    function extractFrames(videoFileName, next) {
      //NOTE: not happy with using error handling for control logic - refactor later
      try {
        fs.mkdirSync(framesDirectory);
      } catch(e) {
        //eat the error - will be thorwn if directory already exists
      }

      publish(progressTopic, 'converting video - part 1').then(() => {
        new ffmpeg(videoFileName).then(video => {
					console.log('extracting frames');
					video.setDisableAudio();
					video.addCommand('-r', 30);
					video.addCommand('-t', 6);
					video.addCommand('-q:v', 3);
					video.addCommand('-f', 'image2');
					video.addCommand('-s', size + 'x' + size);
					video.save(framesDirectory + '/' + vine_id + '_%03d.jpg', (err, files) => {
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
      });
    },
    //function createMontage(videoFileName, next) {},
    //function separateAudio(videoFileName, next) {},
    //function uploadAudioToS3(next) {},
    //function uploadMosaicToS3(next) {},
    //function triggerComplete(next) {},
    //function cleanTmpDirectory(next) {},
    function done() {}
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
  console.log(`uploading ${filename} to S3 key ${key}`)
	fs.readFile(fileName, function (err, data) {
		if (err) {
			next(err);
		}

		const s3 = new aws.S3();
		s3.putObject({ Bucket: s3bucket, Key: key, Body: new Buffer(data, 'binary') }, function(err, data) {
			if (err) {
				next(err);
			} else {
        console.log(`${fileName} uploaded to ${key}`);
				next(null);
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
        qos: 0
      }, (err, data) => {
        if (err) {
          console.log(`iot error: ${err}`);
        }
        return resolve();
      });
  });
}
