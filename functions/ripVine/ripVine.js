'use strict';

process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'];
const AWS = require('aws-sdk');
const async = require('async');
const https = require('https');
const fs = require('fs');
const ffmpeg = require('ffmpeg');
const im = require('gm').subClass({imageMagick: true});
const rimraf = require('rimraf');

const framesDirectory = '/tmp/frames';
const spriteRowsDirectory = '/tmp/rows';
const s3bucket = 'rippedvines-2-0';
const columns = 10;
const size = 300;

module.exports = (event, context, callback) => {
  console.log(`recieved event: ${JSON.stringify(event)}`);
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
				//console.log(fileName + ' uploaded to ' + key);
        console.log(`${fileName} uploaded to ${key}`);
				next(null);
			}
		});
	});
}
