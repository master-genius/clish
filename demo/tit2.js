'use strict';

const clish = require('../clish');

var hosturl = 'https://localhost:2021';

var h2 = new clish();
h2.init(hosturl);

for (let i=0; i<2; i++) {
    
    h2.get({
      endSession: true,
      path : "/",
      encoding : 'utf8'
    })
    .then(data => {
        console.log(data);
    }, err => {
        console.log(err);
    });

    //h2.init(hosturl);
    h2.post({
      path : '/p',
      endSession: true,
      body : {
          user : 'brave'
      },
      encoding : 'utf8'
    })
    .then(data => {
        console.log(data);
    }, err => { console.log(err); });

    /* h2.upload({
        path : '/upload',
        //endSession: true,
        files : {
            file : [
                process.env.HOME + '/tmp/images/123.jpg'
            ]
        },
        encoding: 'utf8'
    }).then(d => {
        console.log(d);
    }); */

}


clish().init(hosturl).download({
    path : '/download',
    endSession: true,
    dir: process.env.HOME + '/tmp'
  })
  .then(data => {
      console.log(data);
  }, err => { console.log(err); });