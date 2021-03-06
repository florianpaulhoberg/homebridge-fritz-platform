const parseString = require('xml2js').parseString;
const axios = require('axios');
const https = require('https');
const debug = require('debug')('FritzPlatformTR064');

class Service{
  
  constructor(device, serviceInfo, config){
  
    this.device = device;
    this.deviceInfo = serviceInfo;
    this.deviceInfo.actionsInfo = [];
    this.actions = {};
    this.config = config;
    
    debug.enabled = config.debug;
    
    this.count = 0;
  
  }

  async _parseSCPD(){
    
    if (this.device.deviceInfo.urlPart && this.device.deviceInfo.urlPart.length > 0) {
    
      this.deviceInfo.SCPDURL = this.deviceInfo.SCPDURL.replace('/tr064', '');
      this.deviceInfo.SCPDURL = this.device.deviceInfo.urlPart + this.deviceInfo.SCPDURL;
    
    }
    
    const url = 'http://' + this.config.host + ':' + this.config.port + this.deviceInfo.SCPDURL;
    
    return new Promise((resolve, reject) => {
    
      axios(url)
        .then(response => {
    
          parseString(response.data,{explicitArray: false}, async (err, result) => {
      
            if(err) return reject(err);
        
            if (!Array.isArray(result.scpd.actionList.action))
              return resolve(this);
    
            for(const action of result.scpd.actionList.action){
      
              const outArgs = [];
              const inArgs = [];
    
              if (action.argumentList && Array.isArray(action.argumentList.argument)) {
      
                for(const argument of action.argumentList.argument){
     
                  if (argument.direction == 'in') {
     
                    inArgs.push(argument.name);
     
                  } else if (argument.direction == 'out') {
     
                    outArgs.push(argument.name);
     
                  }
      
                }
    
              } else if (action.argumentList) {
      
                if (action.argumentList.argument.direction == 'in') {
      
                  inArgs.push(action.argumentList.argument.name);
      
                } else if (action.argumentList.argument.direction == 'out') {
      
                  outArgs.push(action.argumentList.argument.name);
      
                }
    
              }

              this.deviceInfo.actionsInfo.push({
                name: action.name,
                inArgs: inArgs,
                outArgs: outArgs,
              });

              this.actions[action.name] = async (vars) => {
    
                try {
                
                  let ident = action.name.split('_'); 
                  ident = ident ? ident[ident.length-1] : action.name;
                
                  let identifier = {
                    name: ident,
                    count: 0
                  };
                  
                  this.count++;
                  let currCount = this.count;
    
                  let res = await this._sendSOAPActionRequest(this.device,this.deviceInfo.controlURL,this.deviceInfo.serviceType,action.name,inArgs,outArgs,vars,identifier,currCount);
    
                  if(res === 'challenge')
                    res = await this._sendSOAPActionRequest(this.device,this.deviceInfo.controlURL,this.deviceInfo.serviceType,action.name,inArgs,outArgs,vars,identifier,currCount);
    
                  return res;
                  
                }catch(err){
  
                  throw err;
      
                }

              };
    
            }
    
            resolve(this);
      
          });
        
        }).catch(error => {
        
          debug('[TR064 Debug] ' + this.device.deviceInfo.friendlyName + ' api request: Error parsing services!');
      
          if(error.response){
            error = {
              status: error.response.status,
              message: error.response.statusText,
              config: error.config,
              data: error.response.data
            };
          }
            
          reject(error);

        });
    
    });
  
  }

  _sendSOAPActionRequest(device,url,serviceType,action,inArguments,outArguments,vars,ident,currCount){  

    return new Promise((resolve, reject) => {
    
      let port = 0;
      let proto = '';
      let agentOptions = null;
       
      if (device._sslPort) {
      
        port = device._sslPort;
        proto = 'https://';
        agentOptions = { 
          rejectUnauthorized: false 
        }; 
      
      } else {
      
        proto = 'http://';
        port = device.deviceInfo.port;
      
      }
        
      const uri = proto + device.deviceInfo.host + ':' + port + url;
      
      let head = '';
      
      // Content Level Authentication
      if (device._auth.auth) {
        
        head = '<s:Header>' +
                 '<h:ClientAuth xmlns:h="http://soap-authentication.org/digest/2001/10/"' +
                  's:mustUnderstand="1">' +
                  '<Nonce>' +
                  device._auth.sn +
                  '</Nonce>' +
                  '<Auth>' +
                  device._auth.auth +
                  '</Auth>' +
                  '<UserID>' +
                  device._auth.uid +
                  '</UserID>' +
                  '<Realm>' +
                  device._auth.realm +
                  '</Realm>' +
                  '</h:ClientAuth>' +
                  '</s:Header>';
      
      } else {
      
        // First Auth
        head = ' <s:Header>' +
                 '<h:InitChallenge xmlns:h="http://soap-authentication.org/digest/2001/10/"' +
                  's:mustUnderstand="1">' +
                  '<UserID>' +
                  device._auth.uid +
                  '</UserID>' +
                  '<Realm>' +
                  device._auth.realm +
                  '</Realm>' +
                  '</h:InitChallenge>' +
                  '</s:Header>';
      
      }
        
      let body = '<?xml version="1.0" encoding="utf-8"?>' +
                   '<s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s=" http://schemas.xmlsoap.org/soap/envelope/">' +
                    head +
                    '<s:Body>' +
                    '<u:' +
                    action +
                    ' xmlns:u="' +
                    serviceType +
                    '">';
 
      for (const i in vars) {
      
        body += '<' + vars[i].name + '>';
        body += vars[i].value;
        body += '</' + vars[i].name + '>';
      
      }
       
      body = body + '</u:' + action + '>' + '</s:Body>' + '</s:Envelope>';
        
      let options = {
        method: 'POST',
        url: uri,
        agentOptions: agentOptions,
        headers: {
          SoapAction: serviceType + '#' + action,
          'Content-Type': 'text/xml; charset="utf-8"',
        },
        data: body,
        timeout: this.config.timeout,
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      };
      
      debug('[TR064 Debug] ' + device.deviceInfo.friendlyName + ' api request ' + currCount + ': get ' + url);
        
      axios(options)
        .then(response => {
          
          parseString(response.data,{explicitArray: false},(err, result) => {
            
            if(err) return reject(err);
              
            var res = {};
            var env = result['s:Envelope'];
              
            if (env['s:Header']) {
              
              var header = env['s:Header'];
              
              if (header['h:Challenge']) {
              
                debug('[TR064 Debug] ' + device.deviceInfo.friendlyName + ' api request ' + currCount + ': Ok (challenge)');
                
                //Req authentication
                var ch = header['h:Challenge'];
                  
                if(ch.Status == 'Unauthenticated' && ch.Nonce && ident.count < 2){
                  
                  device._auth.des = serviceType;
                  device._auth.sn = ch.Nonce;
                  device._auth.realm = ch.Realm;
                  device._auth.auth = device._calcAuthDigest(device._auth.uid,device._auth.pwd,device._auth.realm,device._auth.sn);
                  device._auth.chCount++;
                  ident.count++;
                    
                  return resolve('challenge');
                    
                } else {
                  
                  return reject('Credentials incorrect');
                  
                }
                
              } else if (header['h:NextChallenge']) {
                
                //Authenticated
                var nx = header['h:NextChallenge'];
                device._auth.auth = nx.Nonce;
                device._auth.chCount = 0;
                device._auth.sn = nx.Nonce;
                device._auth.realm = nx.Realm;
                device._auth.auth = device._calcAuthDigest(device._auth.uid,device._auth.pwd,device._auth.realm,device._auth.sn);
                
              }
              
            }
            
            debug('[TR064 Debug] ' + device.deviceInfo.friendlyName + ' api request ' + currCount + ': Ok (authenticated)');
              
            if (env['s:Body']) {
               
              var body = env['s:Body'];
               
              if (body['u:' + action + 'Response']) { //Authenticated
               
                var responseVars = body['u:' + action + 'Response'];
               
                if (outArguments)
                  for(const arg of outArguments)
                    res[arg] = responseVars[arg];
                      
                resolve(res);

              } else if (body['s:Fault']) { //Not authenticated or error
                
                debug('[TR064 Debug] ' + device.deviceInfo.friendlyName + ' api request ' + currCount + ': Error with authentication!');
                
                var fault = body['s:Fault'];
                
                let error = {
                  desc: 'Error with authentication',
                  tr064: fault ? fault.detail.UPnPError.errorDescription : 'No message',
                  tr064code: fault ? fault.detail.UPnPError.errorCode : 'No code',
                  serviceType: serviceType,
                  action: action
                };
                
                reject(error);
                
              }
              
            }
            
          });
        
        }).catch(error => {
        
          debug('[TR064 Debug] ' + device.deviceInfo.friendlyName + ' api request ' + currCount + ': Error');
      
          if(error.response){
            error = {
              status: error.response.status,
              message: error.response.statusText,
              data: error.response.data,
              serviceType: serviceType,
              action: action
            };
          }
          
          reject(error);
        
        });
    
    });
  
  }
}

exports.Service = Service;
