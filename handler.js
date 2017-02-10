'use strict';

module.exports.ping = (event, context, callback) => {
  const response = {
    statusCode: 200,
    body: 'all is good'
  };

  callback(null, response);
};

module.exports.auth = (event, context, callback) => {
  require('./functions/auth')(event, context, callback);
};

module.exports.ripVine = (event, context, callback) => {
  require('./functions/ripVine/ripVine')(event, context, callback);
};
