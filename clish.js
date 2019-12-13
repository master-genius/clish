/**
 * clish is a http/2 client base on node.js
 * Copyright (c) [2019.08] BraveWang
 * This software is licensed under the MPL-2.0.
 * You can use this software according to the terms and conditions of the MPL-2.0.
 * See the MPL for more details:
 *   https://www.mozilla.org/en-US/MPL/2.0/
*/
'use strict';

const http2 = require('http2');
const crypto = require('crypto');
const fs = require('fs');
const urlparse = require('url');
const qs = require('querystring');
const bodymaker = require('./bodymaker');

//针对HTTPS协议，不验证证书
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var clish = function (options = {}) {
  if (!(this instanceof clish)) {
    return new clish(options);
  }

  this.opts = {};

  for (let k in options) {
    switch (k) {
      case 'max_upload_limit':
      case 'max_upload_size':
      case 'max_file_size':
        this.opts[k] = options[k]; break;
    }
  }

  this.methodList = [
    'GET','POST','PUT','DELETE','OPTIONS', 'PATCH', 'HEAD', 'TRACE'
  ];

  this.bodymaker = new bodymaker(this.opts);
};

clish.prototype.parseUrl = function () {
  var urlobj = new urlparse.URL(url);
  var headers = {
    ':method' : 'GET',
    ':path': urlobj.pathname+urlobj.search,
  };

  if (options.method && this.methodList.indexOf(options.method) >= 0) {
    headers[':method'] = options.method;
  }
  if (options.headers) {
    for (var k in options.headers) {
      headers[k] = options.headers[k];
    }
  }

  return {
    url : urlobj,
    headers:headers
  };
};

clish.prototype.initConn = function (url, options = null) {
  var h = null;
  if (options) {
    h = http2.connect(url, options);
  } else {
    h = http2.connect(url);
  }

  h.on('error', (err) => {
    console.log(err);
    h.close();
  });
  h.on('frameError', (err) => {
    console.log(err);
  });

  return h;
};

clish.prototype.init = function (url, conn_options=null) {
  var ht = {};
  var parseurl = this.parseUrl(url);
  ht.headers = parseurl.headers;
  ht.url = parseurl.url;
  ht.host = 'https://' + ht.url.host;
  ht.tmp_headers = {};
  ht.bodyData = '';

  ht.session = this.initConn(ht.host, conn_options);

  ht.close = () => {
    if (ht.session && !ht.session.closed) {
      ht.session.close();
    }
  };

  ht.payload = async (opts) => {
    var headers = {};
    for (var k in ht.headers) {
      headers[k] = ht.headers[k];
    }

    if (opts.path) {
      headers[':path'] = opts.path;
    }

    if (opts.headers && typeof opts.headers === 'object') {
      for (var k in opts.headers) {
        headers[k] = opts.headers[k];
      }
    }

    if (opts.method && the.methodList.indexOf(opts.method) >= 0) {
      headers[':method'] = opts.method;
    }

    var method = headers[':method'];
    if (method == 'PUT' || method == 'POST' || method == 'PATCH') {
      if (opts.body === undefined) {
        throw new Error('PUT/POST must with body data');
      }
    }

    if (method == 'POST' 
      || method == 'PUT' 
      || method == 'PATCH'
      || (method == 'DELETE' && opts.body)
    ) {
      ht.bodyData = '';
      if (headers['content-type'] === undefined) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
        if (typeof opts.body === 'string') {
          headers['content-type'] = 'text/plain';
        }
      }

      if (headers['content-type'] == 'application/x-www-form-urlencoded') {
        
        ht.bodyData = Buffer.from(qs.stringify(opts.body)).toString('binary');
        headers['content-length'] = ht.bodyData.length;

      } else if (headers['content-type'] === 'multipart/form-data') {
        ht.bodyData = await bodymaker.makeUploadData(opts);
        headers['content-type'] = ht.bodyData['content-type'];
        headers['content-length'] = ht.bodyData['content-length'];
        ht.bodyData = ht.bodyData.body;
      } else if (headers['content-type'].indexOf('multipart/form-data')>=0) {
        if (opts.rawBody) {
          ht.bodyData = opts.rawBody;
          headers['content-length'] = ht.bodyData.length;
        }
      } else {
        ht.bodyData = Buffer.from(
            typeof opts.body === 'object' 
            ? JSON.stringify(opts.body) 
            : opts.body
          ).toString('binary');
        headers['content-length'] = ht.bodyData.length;
      }
    }

    ht.tmp_headers = headers;
  };

  ht.reqStream = function(opts) {
    ht.payload(opts);
    if (opts.request_options) {
      ht.stream = ht.session.request(ht.tmp_headers, opts.request_options);
    } else {
      ht.stream = ht.session.request(ht.tmp_headers);
    }

    if (opts.timeout) {
      ht.stream.setTimeout(opts.timeout);
    }

    ht.stream.on('end', () => {
      if (opts.end) {
        ht.session.close();
      }
      //ht.stream.close();
    });
    
    return ht.stream;
  };

  ht.request = async (opts) => {
    var retBuf = {
      data : '',
      buffers : [],
      length : 0
    };
    return new Promise((rv, rj) => {
      if (ht.session === null || ht.session.closed) {
        ht.session = the.initConn(ht.host, conn_options);
      }
      var t = ht.reqStream(opts);
      t.on('error', (err) => {
        t.close();
        rj(err);
      });
      t.on('frameError', (err) => {
        t.close();
        rj(err);
      });
      if (opts.onResponse && typeof opts.onResponse === 'function') {
        t.on('response', opts.onResponse);
      }

      t.on('data', (data) => {
        if (opts.writeStream) {
          opts.writeStream(data, opts.writeStreamEncoding || 'binary');
        } else {
          //retData += data.toString(opts.encoding || 'utf8');
          retBuf.buffers.push(data);
          retBuf.length += data.length;
        }
      });

      t.on('end', () => {
        if (opts.endSession) {
          ht.session.close();
        }
        let r = Buffer.concat(retBuf.buffers, retBuf.length);
        if (opts.encoding) {
          rv(r.toString(opts.encoding));
        } else {
          rv(r);
        }
      });

      if (opts.events && typeof opts.events === 'object') {
        for(let x in opts.events) {
          if (x === 'error' || x === 'frameError') {
            continue;
          }
          if (typeof opts.events[x] === 'function') {
            t.on(x, opts.events[x]);
          }
        }
      }

      if (ht.bodyData.length > 0 
        && (ht.tmp_headers[':method'] == 'POST'
          || ht.tmp_headers[':method'] == 'DELETE'
          || ht.tmp_headers[':method'] == 'PUT'
          || ht.tmp_headers[':method'] == 'PATCH'
        )
      ) {
        t.end(ht.bodyData, 'binary');
      }
    })
    .then((r) => {
      return r;
    }, (err) => {
      throw err;
    });
  };

  ht.get = async function(opts = {method : 'GET', timeout:35000}) {
    return ht.request(opts);
  };

  ht.post = async function(opts = {}) {
    opts.method = 'POST';
    return ht.request(opts);
  };

  ht.put = async function(opts = {}) {
    opts.method = 'PUT';
    return ht.request();
  };

  ht.delete = async function(opts={}) {
    opts.method = 'DELETE';
    return ht.request(opts);
  };

  ht.upload = async function(opts = {}) {
    if (opts.method === undefined) {
      opts.method = 'POST';
    }
    if (opts.method !== 'POST' && opts.method !== 'PUT') {
      throw new Error('method not be allowed');
    }
    if (!opts.headers) {
      opts.headers = {};
    }
    if (opts.headers['content-type'] === undefined) {
      opts.headers['content-type'] = 'multipart/form-data';
    }
    return ht.request(opts);
  };

  ht.download = async function(opts = {}) {
    if (!opts.method) {
      opts.method == 'GET';
    }
    if (opts.method!=='GET' && opts.method!=='POST' && opts.method=='PUT') {
      throw new Error('method must be GET|POST|PUT');
    }
    if (!opts.dir) {
      opts.dir = './';
    } else if (opts.dir[opts.dir.length-1] !== '/'){
      opts.dir += '/';
    }
    var downStream = null;

    if (opts.progress === undefined) {
      opts.progress = true;
    }
    var filename = '';
    var total_length = 0;
    var sid = null;
    var progressCount = 0;
    var retData = '';
    var down_length = 0;

    return new Promise((rv, rj) => {
      var t = ht.reqStream(opts);
      t.on('error', (err) => {
        t.close();
        rj(err);
      });
      t.on('frameError', (err) => {
        t.close();
        rj(err);
      });

      t.on('response', (headers, flags) => {
        if (headers[':status'] != 200) {
          console.log('status:',headers[':status']);
          t.on('data', data => {
            retData = data.toString('utf8');
            console.log(retData);
          });
        }
        if(headers['content-disposition']) {
          var name_split = headers['content-disposition'].split(';').filter(p => p.length > 0);
    
          for(let i=0; i<name_split.length; i++) {
            if (name_split[i].indexOf('filename*=') >= 0) {
              filename = name_split[i].trim().substring(10);
              filename = filename.split('\'')[2];
              filename = decodeURIComponent(filename);
            } else if(name_split[i].indexOf('filename=') >= 0) {
              filename = name_split[i].trim().substring(9);
            }
          }

        }

        if (!filename) {
          var nh = crypto.createHash('sha1');
          nh.update(`${(new Date()).getTime()}--`);
          filename = nh.digest('hex');
        }

        if (headers['content-length']) {
          total_length = parseInt(headers['content-length']);
        }

        if (opts.target) {
          try {
            downStream = fs.createWriteStream(
              opts.target, {encoding:'binary'}
            );
          } catch(err) {
            console.log(err);
            t.end();
            ht.session.close();
          }
        } else {
          try {
            fs.accessSync(opts.dir+filename, fs.constants.F_OK);
            filename = `${(new Date()).getTime()}-${filename}`;
          } catch(err) {
          }
          downStream = fs.createWriteStream(
            opts.dir+filename,
            {encoding:'binary'}
          );
        }
        if (downStream === null) {
          t.destroy();
          ht.session.close();
          rj(new Error('null write stream'));
        }
        t.on('data', (data) => {
          if (downStream === null) {
            retData += data.toString('binary');
            down_length = retData.length;
          } else {
            if (retData.length > 0) {
              downStream.write(retData, 'binary');
              retData = '';
            }
            down_length += data.length;
            downStream.write(data, 'binary');
          }
          if (opts.progress && total_length > 0) {
            if (down_length >= total_length) {
              console.clear();
              console.log('100.00%');
            }
            else if (progressCount > 25) {
              console.clear();
              console.log(`${((down_length/total_length)*100).toFixed(2)}%`);
              progressCount = 0;
            }
          }
        });
        sid = setInterval(() => {progressCount+=1;}, 20);
      });
      
      t.on('end', () => {
        ht.session.close();
        rv();
      });

      if (ht.bodyData.length > 0 
        && (ht.tmp_headers[':method'] == 'POST'
          || ht.tmp_headers[':method'] == 'DELETE'
          || ht.tmp_headers[':method'] == 'PUT'
        )
      ) {
        t.end(ht.bodyData, 'binary');
      }
    })
    .then((r) => {
      if (opts.progress) {
        console.log('done...');
      }
    }, (err) => {
      throw err;
    })
    .catch(err => {
      console.log(err);
    })
    .finally(() => {
      if (downStream) {
        downStream.end();
      }
      clearInterval(sid);
    });
  };

  return ht;
};

module.exports = clish;
