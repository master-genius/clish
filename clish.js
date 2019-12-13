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

var clish = function (options = {}) {
  if (!(this instanceof clish)) {
    return new clish(options);
  }
  //针对HTTPS协议，不验证证书
  //process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

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

  this.session = null;

  this.headers = {};
  this.tmp_headers = {};
  this.host = '';

};

clish.prototype.parseUrl = function (url) {
  var urlobj = new urlparse.URL(url);
  var headers = {
    ':method' : 'GET',
    ':path': urlobj.pathname+urlobj.search,
  };

  return {
    url : urlobj,
    headers:headers
  };
};

clish.prototype.initConn = function (url, options = {}) {
  var h = http2.connect(url, options);

  h.on('error', (err) => {
    console.log(err);
    h.close();
  });
  h.on('frameError', (err) => {
    console.log(err);
  });

  return h;
};

clish.prototype.init = function (url, conn_options = {}) {

  if (this.session && !this.session.closed) {
    this.session.close();
  }

  var parseurl = this.parseUrl(url);
  this.headers = parseurl.headers;
  this.url = parseurl.url;
  this.host = 'https://' + parseurl.url.host;
  this.tmp_headers = {};

  if (conn_options.requestCert  === undefined) {
    conn_options.requestCert = false;
  }
  if (conn_options.rejectUnauthorized === undefined) {
    conn_options.rejectUnauthorized = false;
  }

  if (conn_options.checkServerIdentity === undefined) {
    conn_options.checkServerIdentity = (name, cert) => {
      
    };
  }

  this.session = this.initConn(this.host, conn_options);
  this.conn_options = conn_options;
  return this;
};

clish.prototype.payload = async function (opts) {
  var headers = {};
  var bodyData = '';
  var tmpbody = {};
  for (var k in this.headers) {
    headers[k] = this.headers[k];
  }

  if (opts.path) {
    headers[':path'] = opts.path;
  }

  if (opts.headers && typeof opts.headers === 'object') {
    for (var k in opts.headers) {
      headers[k] = opts.headers[k];
    }
  }

  if (opts.method && this.methodList.indexOf(opts.method) >= 0) {
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
    if (headers['content-type'] === undefined) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      if (typeof opts.body === 'string') {
        headers['content-type'] = 'text/plain';
      }
    }

    if (headers['content-type'] == 'application/x-www-form-urlencoded') {
      
      bodyData = Buffer.from(qs.stringify(opts.body));
      headers['content-length'] = bodyData.length;

    } else if (headers['content-type'] === 'multipart/form-data') {
      tmpbody = await this.bodymaker.makeUploadData(opts.body);
      headers['content-type'] = tmpbody['content-type'];
      headers['content-length'] = tmpbody['content-length'];
      bodyData = tmpbody.body;
    } else if (headers['content-type'].indexOf('multipart/form-data')>=0) {
      if (opts.rawBody) {
        bodyData = opts.rawBody;
        headers['content-length'] = bodyData.length;
      }
    } else {
      bodyData = Buffer.from(
          typeof opts.body === 'object' 
          ? JSON.stringify(opts.body) 
          : opts.body
        );
      headers['content-length'] = bodyData.length;
    }
  }

  return {body : bodyData, headers : headers};
};

clish.prototype.reqStream = async function (opts) {
  var stream = null;
  var hb = await this.payload(opts);
  
  if (opts.request_options) {
    stream = this.session.request(hb.headers, opts.request_options);
  } else {
    stream = this.session.request(hb.headers);
  }
  if (opts.timeout) {
    stream.setTimeout(opts.timeout);
  }

  var retBuf = {
    data : '',
    buffers : [],
    length : 0
  };

  if (opts.events && typeof opts.events === 'object') {
    for(let x in opts.events) {
      if (x === 'error' || x === 'frameError') {
        continue;
      }
      if (typeof opts.events[x] === 'function') {
        stream.on(x, opts.events[x]);
      }
    }
  }

  return new Promise((rv, rj) => {  
    stream.on('error', (err) => {
      stream.close();
      rj(err);
    });
    stream.on('frameError', (err) => {
      stream.close();
      rj(err);
    });
    if (opts.onResponse && typeof opts.onResponse === 'function') {
      stream.on('response', opts.onResponse);
    }

    stream.on('data', (data) => {
      if (opts.writeStream) {
        opts.writeStream(data, opts.writeStreamEncoding || 'binary');
      } else {
        retBuf.buffers.push(data);
        retBuf.length += data.length;
      }
    });

    stream.on('end', () => {
      if (opts.endSession) {
        if (stream.session && !stream.session.closed) {
          stream.session.close();
        }
      }
      let r = Buffer.concat(retBuf.buffers, retBuf.length);
      if (opts.encoding) {
        rv(r.toString(opts.encoding));
      } else {
        rv(r);
      }
    });

    if (hb.body.length > 0 
      && (hb.headers[':method'] == 'POST'
        || hb.headers[':method'] == 'DELETE'
        || hb.headers[':method'] == 'PUT'
        || hb.headers[':method'] == 'PATCH'
      )
    ) {
      stream.end(hb.body);
    }
  })
  .then((r) => {
    return r;
  }, (err) => {
    throw err;
  });
};

clish.prototype.request = async function (opts) {
  if (this.session === null || this.session.closed) {
    this.session = this.initConn(this.host, this.conn_options);
  }
  return this.reqStream(opts);
};

clish.prototype.get = async function(opts = {method : 'GET', timeout:85000}) {
  return this.request(opts);
};

clish.prototype.post = async function(opts = {}) {
  opts.method = 'POST';
  return this.request(opts);
};

clish.prototype.put = async function(opts = {}) {
  opts.method = 'PUT';
  return this.request();
};

clish.prototype.delete = async function(opts={}) {
  opts.method = 'DELETE';
  return this.request(opts);
};

clish.prototype.upload = async function(opts = {}) {
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
  if (!opts.files && !opts.form && !opts.body && !opts.rawBody) {
    throw new Error('Error: file or form not found.');
  }
  //没有设置body，但是存在files或form，则自动打包成request需要的格式。
  if (!opts.body) {
      opts.body = {};
      if (opts.files) {
          opts.body.files = opts.files;
          //delete opts.files;
      }
      if (opts.form) {
          opts.body.form = opts.form;
          //delete opts.form;
      }
  }
  return this.request(opts);
};

clish.prototype.download = async function(opts = {}) {
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
  var hb = await this.payload(opts);
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
  var t;

  if (opts.request_options) {
    t = this.session.request(hb.headers, opts.request_options);
  } else {
    t = this.session.request(hb.headers);
  }

  if (opts.timeout) {
    t.setTimeout(opts.timeout);
  }

  return new Promise((rv, rj) => {
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
          //console.log(retData);
        });
      }
      if(headers['content-disposition']) {
        var name_split = headers['content-disposition']
                          .split(';')
                          .filter(p => p.length > 0);
  
        for(let i=0; i<name_split.length; i++) {
          console.log('find');
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
        /* if (opts.progress && total_length > 0) {
          if (down_length >= total_length) {
            console.clear();
            console.log('100.00%');
          }
          else if (progressCount > 25) {
            console.clear();
            console.log(`${((down_length/total_length)*100).toFixed(2)}%`);
            progressCount = 0;
          }
        } */
      });
      //sid = setInterval(() => {progressCount+=1;}, 20);
    });
    
    t.on('end', () => {
      rv();
    });

    if (hb.body.length > 0 
      && (hb.headers[':method'] == 'POST'
        || hb.headers[':method'] == 'DELETE'
        || hb.headers[':method'] == 'PUT'
      )
    ) {
      t.end(hb.body);
    }
  })
  .then((r) => {
    /* if (opts.progress) {
      console.log('done...');
    } */
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
    if (opts.endSession) {
      if (this.session && !this.session.closed) {
        this.session.close();
      }
    }
    //clearInterval(sid);
  });
};

module.exports = clish;
