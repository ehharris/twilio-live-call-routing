// ==========================================================================
// Splunk On-Call Live Call Routing
// Copyright 2025 Splunk, Inc.
// https://github.com/victorops/twilio-live-call-routing/blob/master/LICENSE
// ==========================================================================

const qs = require('qs');
const got = require('got');
const _ = require('lodash');

module.exports = {
  assignTeam,
  buildOnCallList,
  call,
  callOrMessage,
  handler,
  isHuman,
  leaveAMessage,
  main,
  postToVictorOps,
  teamsMenu
};

// Make changes to messages if you want to modify what is spoken during a call
// Message keys starting with 'vo' are the text that show up in On-Call timeline alerts
function handler (context, event, callback) {
  let {ALERT_HOST, API_HOST, NUMBER_OF_MENUS, voice, NO_VOICEMAIL, NO_CALL} = context;
  context.NO_CALL = _.isUndefined(NO_CALL)
    ? 'false'
    : NO_CALL.toLowerCase();
  const messages = {
    missingConfig: 'There is a missing configuration value. Please contact your administrator to fix the problem.',
    greeting: 'Welcome to Splunk Lyve Call Routing.',
    menu: 'Please press 1 to reach an on-call representative or press 2 to leave a message.',
    noVMmenu: 'Please press 1 to reach an on-call representative or press 2 to request a callback from the team',
    zeroToRepeat: 'Press zero to repeat this menu.',
    noResponse: 'We did not receive a response.',
    invalidResponse: 'We did not receive a valid response.',
    goodbye: 'Goodbye.',
    noTeamsError: 'There was an error retrieving the list of teams for your organization.',
    otherPartyDisconnect: 'The other party has disconnected.',
    attemptTranscription: 'Twilio will attempt to transcribe your message and create an incident in Splunk On-Call.',
    pressKeyToConnect: 'This is Splunk Lyve Call Routing. Press any number to connect.',
    errorGettingPhoneNumbers: 'There was an error retrieving the on-call phone numbers. Please try again.',
    nextOnCall: 'Trying next on-call representative.',
    connected: 'You are now connected.',
    noAnswer: (context.NO_CALL == 'true') ? '' : 'We were unable to reach an on-call representative.',
    voicemail: (team) => `Please leave a message for the ${team} team and hang up when you are finished.'`,
    noVoicemail: (team) => `We are creating an incident for the ${team} team.  Someone will call you back shortly.`,
    connecting: (team) => (context.NO_CALL == 'true') ? '' : `We are connecting you to the representative on-call for the ${team} team - Please hold.`,
    voTwilioMessageDirect: (team) => `Twilio: message left for the ${team} team`,
    voTwilioMessageAfter: (team) => (context.NO_CALL == 'true') ? 'Twilio: New Voicemail' : `Twilio: unable to reach on-call for the ${team} team`,
    voTwilioTransciption: (transcription, log) => `Transcribed message from Twilio:\n${transcription}${log || ''}`,
    voTwilioTransciptionFail: (log) => `Twilio was unable to transcribe message.${log || ''}`,
    voCallAnswered: (user, caller, log) => `${user} answered a call from ${caller}.${log}`,
    voCallNotAnswered: (caller) => `Missed call from ${caller}.`,
    voCallCompleted: (user, caller, log) => `${user} answered a call from ${caller}. ${log}`,
    noTeam: (team) => `Team ${team} does not exist. Please contact your administrator to fix the problem.`
  };
  const {VICTOROPS_API_KEY, VICTOROPS_API_ID} = context;
  const {payloadString, To} = event;
  const payload = _.isUndefined(payloadString)
    ? {}
    : JSON.parse(payloadString);
  context.ALERT_HOST = _.isUndefined(ALERT_HOST)
    ? 'alert.victorops.com'
    : ALERT_HOST;
  context.API_HOST = _.isUndefined(API_HOST)
    ? 'api.victorops.com'
    : API_HOST;
  context.NO_VOICEMAIL = _.isUndefined(NO_VOICEMAIL)
    ? 'false'
    : NO_VOICEMAIL;
  context.messages = messages;
  context.headers = {
    'Content-Type': 'application/json',
    'X-VO-Api-Key': VICTOROPS_API_KEY,
    'X-VO-Api-Id': VICTOROPS_API_ID
  };
  switch (NUMBER_OF_MENUS) {
    case '1':
      break;
    case '2':
      break;
    default:
      context.NUMBER_OF_MENUS = '0';
      break;
  }
  // Add 'voice' key in Twilio config to change how Twilio sounds [default = 'Polly.Salli', 'Polly.Matthew', 'Polly.Joanna']
  payload.voice = (voice === 'alice' || voice === 'man')
    ? voice
    : 'Polly.Salli';
  let {callerId} = payload;
  payload.callerId = _.isUndefined(callerId)
    ? To
    : callerId;

  let twiml = new Twilio.twiml.VoiceResponse();

  if (requiredConfigsExist(context)) {
    main(twiml, context, event, payload)
    .then(result => callback(null, result))
    .catch(err => console.log(err));
  } else {
    twiml.say(
      {voice: payload.voice},
      context.messages.missingConfig
    );

    callback(null, twiml);
  }
}

// Checks that all required configuration values have been entered in Twilio configure
function requiredConfigsExist (context) {
  const {VICTOROPS_API_ID, VICTOROPS_API_KEY, VICTOROPS_TWILIO_SERVICE_API_KEY} = context;
  if (
    _.isUndefined(VICTOROPS_API_ID) ||
    _.isUndefined(VICTOROPS_API_KEY) ||
    _.isUndefined(VICTOROPS_TWILIO_SERVICE_API_KEY)
  ) {
    return false;
  } else {
    return true;
  }
}

// Routes to the appropriate function based on the value of 'runFunction'
function main (twiml, context, event, payload) {
  const {NUMBER_OF_MENUS} = context;
  const {runFunction} = payload;

  if (_.isUndefined(runFunction)) {
    switch (NUMBER_OF_MENUS) {
      case '1':
        return teamsMenu(twiml, context, event, payload);
      case '2':
        return callOrMessage(twiml, context, payload);
      default:
        return teamsMenu(twiml, context, event, payload);
    }
  }

  switch (runFunction) {
    case 'teamsMenu':
      return teamsMenu(twiml, context, event, payload);
    case 'assignTeam':
      return assignTeam(twiml, context, event, payload);
    case 'buildOnCallList':
      return buildOnCallList(twiml, context, payload);
    case 'call':
      return (context.NO_CALL == 'true')
        ? leaveAMessage(twiml, context, event, payload)
        : call(twiml, context, event, payload);
    case 'isHuman':
      return isHuman(twiml, context, event, payload);
    case 'leaveAMessage':
      return leaveAMessage(twiml, context, event, payload);
    case 'postToVictorOps':
      return postToVictorOps(event, context, payload);
    default:
      return new Promise((resolve, reject) => reject(new Error('No function was called.')));
  }
}

// Wrapper that prevents logging while running local test
function log (string, content) {
  if (process.env.NODE_ENV !== 'test') {
    console.log(string, content);
  }
}

// Menu to choose to reach someone on-call or leave a message
function callOrMessage (twiml, context, payload) {
  log('callOrMessage', payload);
  return new Promise((resolve, reject) => {
    const {messages, NO_VOICEMAIL} = context;
    const {callerId, voice} = payload;

    let menu = messages.menu
    if (NO_VOICEMAIL.toLowerCase() === 'true'){
        menu = messages.noVMmenu
    }

    twiml.gather(
      {
        input: 'dtmf',
        timeout: 10,
        action: generateCallbackURI(
          context,
          {
            callerId,
            fromCallorMessage: true,
            runFunction: 'teamsMenu'
          }
        ),
        numDigits: 1
      }
    )
    .say(
      {voice},
      `${messages.greeting} ${menu} ${messages.zeroToRepeat}`
    );
    twiml.say(
      {voice},
      `${messages.noResponse} ${messages.goodbye}`
    );

    resolve(twiml);
  });
}

// Helper function to generate the callback URI with the required data
function generateCallbackURI (context, json) {
  const {DOMAIN_NAME} = context;
  const payloadString = JSON.stringify(json);

  return `https://${DOMAIN_NAME}/victorops-live-call-routing?${qs.stringify({payloadString})}`;
}

// Menu to select team to contact for on-call or leaving a message
function teamsMenu (twiml, context, event, payload) {
  log('teamsMenu', event);
  return new Promise((resolve, reject) => {
    const {API_HOST, headers, messages, NUMBER_OF_MENUS} = context;
    let {Digits, From} = event;
    Digits = parseInt(Digits);
    const {callerId, fromCallorMessage, voice} = payload;
    let {goToVM} = payload;

    // Repeats the call or message menu if caller pressed 0
    if (Digits === 0) {
      twiml.redirect(
        generateCallbackURI(
          context,
          {callerId}
        )
      );

      resolve(twiml);
    // Repeats the call or message menu if caller did not enter a valid response
    } else if (fromCallorMessage === true && Digits !== 1 && Digits !== 2) {
      twiml.say(
        {voice},
        `${messages.invalidResponse}`
      );
      twiml.redirect(
        generateCallbackURI(
          context,
          {callerId}
        )
      );

      resolve(twiml);
    } else {
      got(
        `https://${API_HOST}/api-public/v1/team`,
        {headers}
      )
      .then(response => {
        let teamsArray;
        let teamLookupFail = false;

        if (Digits === 2) {
          goToVM = true;
          realCallerId = From;
        }

        // If Twilio configure has any keys starting with 'TEAM',
        // these teams will be used instead of pulling a list of teams from VictorOps
        if (_.isEmpty(buildManualTeamList(context))) {
          teamsArray = JSON.parse(response.body)
          .map(team => {
            return {
              name: team.name,
              slug: team.slug
            };
          });
        } else {
          teamsArray = buildManualTeamList(context)
          .map(team => {
            const lookupResult = lookupTeamSlug(team.name, JSON.parse(response.body));

            if (lookupResult.teamExists) {
              return {
                name: team.name,
                slug: lookupResult.slug,
                escPolicyName: team.escPolicyName
              };
            } else {
              teamLookupFail = true;
              twiml.say(
                {voice},
                `${messages.noTeam(team.name)} ${messages.goodbye}`
              );

              resolve(twiml);
            }
          });
        }

        if (teamLookupFail) {
          return;
        }

        // An error message is read and the call ends if there are no teams available
        if (teamsArray.length === 0) {
          twiml.say(
            {voice},
            `${messages.noTeamsError} ${messages.goodbye}`
          );
        // Automatically moves on to next step if there is only one team
        } else if (teamsArray.length === 1 || NUMBER_OF_MENUS === '0') {
          teamsArray = [teamsArray[0]];
          const autoTeam = true;
          twiml.redirect(
            generateCallbackURI(
              context,
              {
                autoTeam,
                callerId,
                goToVM,
                runFunction: 'assignTeam',
                teamsArray
              }
            )
          );
        // Generates the menu of teams to prompt the caller to make a selection
        } else {
          let menuPrompt = 'Please press';

          teamsArray.forEach((team, i, array) => {
            menuPrompt += ` ${i + 1} for ${team.name}.`;
          });

          if (NUMBER_OF_MENUS === '1') {
            menuPrompt = `${messages.greeting} ${menuPrompt}`;
          }

          twiml.gather(
            {
              input: 'dtmf',
              timeout: 5,
              action: generateCallbackURI(
                context,
                {
                  callerId,
                  goToVM,
                  runFunction: 'assignTeam',
                  teamsArray
                }
              ),
              numDigits: teamsArray.length.toString().length
            }
          )
          .say(
            {voice},
            `${menuPrompt} ${messages.zeroToRepeat}`
          );
          // If no response is received from the caller, the call ends
          twiml.say(
            {voice},
            `${messages.noResponse} ${messages.goodbye}`
          );
        }

        resolve(twiml);
      })
      .catch(err => {
        console.log(err);
        twiml.say(
          {voice},
          `${messages.noTeamsError} ${messages.goodbye}`
        );

        resolve(twiml);
      });
    }
  });
}

// Creates a list of teams for the teamsMenu if there are any keys that begin with 'TEAM' in Twilio configure
function buildManualTeamList (context) {
  log('buildManualTeamsList', context);
  let arrayOfTeams = [];

  Object.keys(context).forEach((key) => {
    if (key.substring(0, 4).toLowerCase() === 'team') {
      const name = context[key];
      const keyId = key.substring(4);
      let escPolicyName;

      Object.keys(context).forEach((key) => {
        if (key.substring(0, 7).toLowerCase() === 'esc_pol' && key.substring(7) === keyId) {
          escPolicyName = context[key];
        }
      });

      arrayOfTeams.unshift(
        {
          name,
          escPolicyName
        }
      );
      arrayOfTeams.sort((a, b) => (a.name > b.name) ? 1 : -1);
      arrayOfTeams.reverse();
    }
  });

  return arrayOfTeams;
}

// Gets the team slug for a team if it exists
function lookupTeamSlug (teamName, teamList) {
  for (let team of teamList) {
    if (team.name === teamName) {
      return {
        teamExists: true,
        slug: team.slug
      };
    }
  }

  return {
    teamExists: false,
    name: teamName
  };
}

// Handles the caller's input and chooses the appropriate team
function assignTeam (twiml, context, event, payload) {
  log('assignTeam', event);
  return new Promise((resolve, reject) => {
    const {messages} = context;
    let {Digits, From} = event;
    Digits = parseInt(Digits);
    const {autoTeam, callerId, goToVM, voice} = payload;

    // Repeats the teams menu if caller pressed 0
    if (Digits === 0) {
      twiml.redirect(
        generateCallbackURI(
          context,
          {
            callerId,
            goToVM,
            runFunction: 'teamsMenu'
          }
        )
      );
    // If caller enters an invalid selection, the call ends
    } else if (isNaN(Digits) && autoTeam !== true) {
      twiml.say(
        {voice},
        `${messages.invalidResponse} ${messages.goodbye}`
      );
    // Take the appropriate action based on call or message menu
    } else {
      let realCallerId = From;
      let {teamsArray} = payload;

      // Take the caller to voicemail
      if (goToVM === true) {
        if (teamsArray.length === 1) {
          twiml.redirect(
            generateCallbackURI(
              context,
              {
                callerId,
                goToVM,
                realCallerId,
                runFunction: 'leaveAMessage',
                teamsArray
              }
            )
          );
        } else if (Digits <= teamsArray.length) {
          teamsArray = [teamsArray[Digits - 1]];
          twiml.redirect(
            generateCallbackURI(
              context,
              {
                callerId,
                goToVM,
                realCallerId,
                runFunction: 'leaveAMessage',
                teamsArray
              }
            )
          );
        // If the caller entered an invalid response, the call ends
        } else {
          twiml.say(
            {voice},
            `${messages.invalidResponse} ${messages.goodbye}`
          );
        }
      // Proceed to attempt to build a list of people on-call
      } else if (teamsArray.length === 1) {
        twiml.redirect(
          generateCallbackURI(
            context,
            {
              callerId,
              goToVM,
              realCallerId,
              runFunction: 'buildOnCallList',
              teamsArray
            }
          )
        );
      } else if (Digits <= teamsArray.length) {
        teamsArray = [teamsArray[Digits - 1]];
        twiml.redirect(
          generateCallbackURI(
            context,
            {
              realCallerId,
              callerId,
              goToVM,
              runFunction: 'buildOnCallList',
              teamsArray
            }
          )
        );
      // If the caller entered an invalid response, the call ends
      } else {
        twiml.say(
          {voice},
          `${messages.invalidResponse} ${messages.goodbye}`
        );
      }
    }

    resolve(twiml);
  });
}

// Generates a list of people on-call and their phone numbers
function buildOnCallList (twiml, context, payload) {
  log('buildOnCallList', payload);
  return new Promise((resolve, reject) => {
    const {messages, NUMBER_OF_MENUS} = context;
    const {callerId, teamsArray, voice, realCallerId} = payload;

    // Creates a list of phone numbers based on the first 3 escalation policies
    const escPolicyUrlArray = createEscPolicyUrls(context, teamsArray[0].slug);
    // Gathers all overrides for team's EP's
    const overrides = getActiveOverrides(context, escPolicyUrlArray[0], teamsArray[0].escPolicyName);
    const prom1 = Promise.resolve(overrides);
    // Gets phone numbers for active OnCall users
    prom1.then(overridePairs => {
      const phoneNumberArray = escPolicyUrlArray.map(url => getPhoneNumbers(context, url, teamsArray[0].escPolicyName, overridePairs));
      Promise.all(phoneNumberArray)
      .then(phoneNumbers => {
        phoneNumbers = phoneNumbers.filter(phoneNumber => phoneNumber !== false);
        log('phoneNumbers', phoneNumbers);

        let message = messages.connecting(teamsArray[0].name);

        // Welcome message if caller has not heard any other menu
        if (NUMBER_OF_MENUS === '0') {
          message = `${messages.greeting} ${message}`;
        }

        // If there is no one on-call with a phone number, go to voicemail
        if (phoneNumbers.length === 0) {
          twiml.redirect(
            generateCallbackURI(
              context,
              {
                phoneNumbers,
                realCallerId,
                runFunction: 'leaveAMessage',
                teamsArray
              }
            )
          );
        // Move on to trying connect caller with people on-call
        } else {
          twiml.say(
            {voice},
            message
          );
          twiml.redirect(
            generateCallbackURI(
              context,
              {
                callerId,
                firstCall: true,
                phoneNumbers,
                realCallerId,
                runFunction: 'call',
                teamsArray
              }
            )
          );
        }

        resolve(twiml);
      })
    })
    .catch(err => {
      console.log(err);
      twiml.say(
        {voice},
        `${messages.errorGettingPhoneNumbers}`
      );
      resolve(twiml);
    });
  });
}

// Helper function that generates a list of URI's from which to request data from VictorOps with
function createEscPolicyUrls (context, teamSlug) {
  log('createEscPolicyUrls', teamSlug);
  const {API_HOST} = context;
  const onCallUrl = `https://${API_HOST}/api-public/v2/team/${teamSlug}/oncall/schedule?step=`;
  const arrayOfUrls = [];

  for (let i = 0; i <= 2; i++) {
    arrayOfUrls.push(`${onCallUrl}${i}`);
  }
  return arrayOfUrls;
}

// Generates a list of phone numbers
// Randomly picks on person if there is more than one person on-call for an escalation policy
function getPhoneNumbers (context, escPolicyUrl, escPolicyName, overrides1) {
  return new Promise((resolve, reject) => {
    const {API_HOST, headers} = context;

    got(
      escPolicyUrl,
      {headers}
    )
    .then(response => {
      const body = JSON.parse(response.body);
      const {schedules} = body;
      const onCallArray = [];
      let escPolicyAssigned;
      let schedule;

      // Check if an escalation policy has been specified in the Twilio UI
      if (!(_.isUndefined(escPolicyName))) {
        escPolicyAssigned = true;
      } else {
        escPolicyAssigned = false;
      }

      // Get the specified escalation policy or get the first one if none is specified
      if (escPolicyAssigned) {
        schedule = setSchedule(schedules, escPolicyName);
      } else if (schedules.length > 0) {
        schedule = schedules[0].schedule;
      } else {
        schedule = false;
      }

      if (schedule === false) {
        return resolve(false);
      }

      // Checks for overrides
      schedule.forEach((rotation) => {
        if (overrides1.size > 0){
          if (!(_.isUndefined(rotation.onCallUser)) && (!(overrides1.has(rotation.rotationName)))){
            //console.log("no-override1");
            onCallArray.push(rotation.onCallUser.username);        
          } else if (overrides1.has(rotation.rotationName)) { 
            console.log("override");
            onCallArray.push(overrides1.get(rotation.rotationName));
          }
        } else if (!(_.isUndefined(rotation.onCallUser))) {
          //console.log("no-override2");
          onCallArray.push(rotation.onCallUser.username);
        }
      });

      if (onCallArray.length === 0) {
        return resolve(false);
      }

      const randomIndex = Math.floor(Math.random() * onCallArray.length);

      got(
        `https://${API_HOST}/api-public/v1/user/${onCallArray[randomIndex]}/contact-methods/phones`,
        {headers}
      )
      .then(response => {
        const body = JSON.parse(response.body);

        if (body.contactMethods.length === 0) {
          return resolve(false);
        } else {
          return resolve(
            {
              phone: body.contactMethods[0].value,
              user: onCallArray[randomIndex]
            }
          );
        }
      })
      .catch(err => {
        console.log(err);

        return reject(err);
      });
    })
    .catch(err => {
      console.log(err);

      return reject(err);
    });
  });
}

//Helper function to check for overrides, returns rotationName and username of override
function getActiveOverrides(context, escUrl, escPolicyName){
  modEscPolicyUrl = escUrl.slice(0, -1) + "0";
  return new Promise((resolve, reject) => {
    const {headers} = context;

    got(
      modEscPolicyUrl,
      {headers}
    )
    .then(response => {
      const body = JSON.parse(response.body);
      let schedulesArg = [];
      //console.log(body);
      let schedules2 = body.schedules;
      //console.log(schedules2);
 
      for (let schedule in schedules2) { 
          schedulesArg.push(schedules2[schedule].schedule);
      }
      
      // CUSTOM BEHAVIOR: Determines active overrides for each EP, passes on first rotation used in EP for association in case user is overriding for a "Secondary" rotation that's unaccounted for
      let overridePairs = new Map();
      for (let schedule in schedulesArg){
        //console.log(schedulesArg[schedule]);
        for (let schedule2 in schedulesArg[schedule]){
          if (!(_.isUndefined(schedulesArg[schedule][schedule2].overrideOnCallUser))) {  
           overridePairs.set(schedulesArg[schedule][schedule2].rotationName, schedulesArg[schedule][schedule2].overrideOnCallUser.username);
          }
        }
      }
      console.log(overridePairs);
      return resolve(overridePairs);
    })
    .catch(err => {
      console.log(err);
      return reject(err);
    });
  })
  .catch(err => {
    console.log(err);
    return reject(err);
  });
}


// Helper function that returns the schedule object if a valid escalation policy is configured in the Twilio UI
function setSchedule (schedulesArray, escPolicyName) {
  for (let schedule in schedulesArray) {
    console.log(schedulesArray[schedule].policy.name);
    if (schedulesArray[schedule].policy.name === escPolicyName) {
      //console.log(schedulesArray[schedule].schedule[0].rotationName);
      return schedulesArray[schedule].schedule;
    }
  }
  return false;
}

// Connects caller to people on-call and builds a log of calls made
function call (twiml, context, event, payload) {
  log('call', event);
    const {messages} = context;
    const {DialCallStatus, From, DialBridged, CallSid} = event;
    const {callerId, firstCall, goToVM, phoneNumbers, teamsArray, voice} = payload;
    let {detailedLog, realCallerId} = payload;
    let phoneNumber;
    
    // Caller was connected to on-call person and call completed
    if (DialCallStatus === 'completed' && DialBridged == 'true') {
      twiml.say(
        {voice},
        `${messages.otherPartyDisconnect} ${messages.goodbye}`
      );
      return postToVictorOps(event, context, payload);
    } else {
      return new Promise((resolve, reject) => {
        if (firstCall !== true) {
          twiml.say(
            {voice},
            `${messages.nextOnCall}`
          );
        } else {
          realCallerId = From;
        }

        // Attempt to connect to last on-call person and go to voicemail if no answer
        if (phoneNumbers.length === 1) {
          phoneNumber = phoneNumbers[0];
          detailedLog = `\n\n${From} calling ${phoneNumber.user}...${detailedLog || ''}`;
          twiml.dial(
            {
              action: generateCallbackURI(
                context,
                {
                  entityId:CallSid,
                  callerId,
                  realCallerId,
                  goToVM,
                  detailedLog,
                  phoneNumber,
                  phoneNumbers,
                  runFunction: 'leaveAMessage',
                  teamsArray
                }
              ),
              callerId
            }
          )
          .number(
            {
              url: generateCallbackURI(
                context,
                {
                  callerId,
                  realCallerId,
                  detailedLog,
                  phoneNumber,
                  phoneNumbers,
                  runFunction: 'isHuman',
                  teamsArray
                }
              ),
              statusCallback: generateCallbackURI(
                context,
                {
                  callerId,
                  realCallerId,
                  detailedLog,
                  goToVM,
                  phoneNumber,
                  phoneNumbers,
                  runFunction: 'postToVictorOps',
                  teamsArray
                }
              ),
              statusCallbackEvent: 'completed'
            },
            phoneNumber.phone
          );
        // Attempt to connect to first on-call person and attempt to connect to next on-call person if no answer
        } else {
          phoneNumber = phoneNumbers[0];
          phoneNumbers.shift();
          detailedLog = `\n\n${From} calling ${phoneNumber.user}...${detailedLog || ''}`;
          twiml.dial(
            {
              action: generateCallbackURI(
                context,
                {
                  entityId:CallSid,
                  callerId,
                  detailedLog,
                  phoneNumber,
                  phoneNumbers,
                  realCallerId,
                  runFunction: 'call',
                  teamsArray
                }
              ),
              callerId
            }
          )
          .number(
            {
              url: generateCallbackURI(
                context,
                {
                  callerId,
                  detailedLog,
                  phoneNumber,
                  phoneNumbers,
                  realCallerId,
                  runFunction: 'isHuman',
                  teamsArray
                }
              ),
              statusCallback: generateCallbackURI(
                context,
                {
                  callerId,
                  detailedLog,
                  phoneNumber,
                  phoneNumbers,
                  realCallerId,
                  runFunction: 'postToVictorOps',
                  teamsArray
                }
              ),
              statusCallbackEvent: 'completed'
            },
            phoneNumber.phone
          );
        }
      resolve(twiml);
    });
  }
}

// Asks called party for an input when they pick up the phone to differentiate between human and voicemail
function isHuman (twiml, context, event, payload) {
  log('isHuman', event);
  return new Promise((resolve, reject) => {
    const {messages} = context;
    const {Digits} = event;
    const {detailedLog, phoneNumber, phoneNumbers, realCallerId, teamsArray, voice} = payload;

    if (_.isUndefined(Digits)) {
      twiml.gather(
        {
          input: 'dtmf',
          timeout: 8,
          action: generateCallbackURI(
            context,
            {
              detailedLog,
              phoneNumber,
              phoneNumbers,
              realCallerId,
              runFunction: 'isHuman',
              teamsArray
            }
          ),
          numDigits: 1
        }
      )
      .say(
        {voice},
        `${messages.pressKeyToConnect}`
      );
      twiml.say(
        {voice},
        `${messages.noResponse} ${messages.goodbye}`
      );
      twiml.hangup();
    } else {
      twiml.say(
        {voice},
        `${messages.connected}`
      );
      twiml.redirect(
        generateCallbackURI(
          context,
          {
            callAnsweredByHuman: true,
            detailedLog,
            phoneNumber,
            phoneNumbers,
            realCallerId,
            runFunction: 'postToVictorOps',
            teamsArray
          }
        )
      );
    }
    resolve(twiml);
  });
}

// Records caller's message and transcribes it
function leaveAMessage (twiml, context, event, payload) {
  log('leaveAMessage', event);
    const {messages, NO_VOICEMAIL} = context;
    const {DialCallStatus, DialBridged} = event;
    const {callerId, detailedLog, goToVM, teamsArray, sayGoodbye, voice, realCallerId} = payload;
    
    // Caller was connected to on-call person and call completed
    if (DialCallStatus == 'completed' && DialBridged == 'true') {
      return postToVictorOps(event, context, payload);
    } else {
      return new Promise((resolve, reject) => {
        // If caller does not hang up after leaving message,
        // this message will play and then end the call
        //} 
        if (sayGoodbye === true) {
          twiml.say(
            {voice},
            `${messages.attemptTranscription} ${messages.goodbye}`
          );

          let message = messages.voicemail(teamsArray[0].name);

        if (goToVM !== true) {
          message = `${messages.noAnswer} ${message}`;
        }

        twiml.say(
          {voice},
          message
        );
        twiml.record(
          {
            transcribe: true,
            transcribeCallback: generateCallbackURI(
              context,
              {
                callerId,
                detailedLog,
                goToVM,
                runFunction: 'postToVictorOps',
                teamsArray
              }
            ),
            timeout: 10,
            action: generateCallbackURI(
              context,
              {
                callerId,
                detailedLog,
                runFunction: 'leaveAMessage',
                sayGoodbye: true,
                teamsArray
              }
            )
          }
        );
      // If the no voicemail flag is set then we want to play the no voicemail message
      // and still create an incident in VO with the caller's phone number
      } else if (NO_VOICEMAIL.toLowerCase() === 'true') {
        let message = messages.noVoicemail(teamsArray[0].name);

        if (goToVM !== true) {
          message = `${messages.noAnswer} ${message}`;
        }

        twiml.say(
          {voice},
          message
        );
        twiml.redirect(
          generateCallbackURI(
            context,
            {
              realCallerId,
              callerId,
              goToVM,
              runFunction: 'postToVictorOps',
              teamsArray
            }
          )
        );

      // Play a message, record the caller's message, transcribe caller's message
      } else {
        let message = messages.voicemail(teamsArray[0].name);

        if (goToVM !== true) {
          message = `${messages.noAnswer} ${message}`;
        }

        twiml.say(
          {voice},
          message
        );
        twiml.record(
          {
            transcribe: true,
            transcribeCallback: generateCallbackURI(
              context,
              {
                realCallerId,
                callerId,
                detailedLog,
                goToVM,
                runFunction: 'postToVictorOps',
                teamsArray
              }
            ),
            timeout: 10,
            action: generateCallbackURI(
              context,
              {
                realCallerId,
                callerId,
                detailedLog,
                runFunction: 'leaveAMessage',
                sayGoodbye: true,
                teamsArray
              }
            )
          }
        );
      }
      resolve(twiml);
    });
  }
}

function emailVoicemailLink (event, context, transcription_status){
  //Attempt to email voicemail
  //Initialize SendGrid Mail Client          to: context.TO_EMAIL_ADDRESS,
  const sgMail = require('@sendgrid/mail');

  // Define Handler function required for all Twilio Functions
  //exports.handler = function(context, event, callback) {
  // Build SG mail request
  sgMail.setApiKey(context.SENDGRID_API_SECRET);													 
  let msg;
  if (transcription_status != false){
    // Define message params
      msg = {
      to: context.TO_EMAIL_ADDRESS,
      from: context.FROM_EMAIL_ADDRESS,
      text: `New Splunk On-Call Voicemail from: ${event.From}\n Transcription is: ${event.TranscriptionText}\n Recording URL is: ${event.RecordingUrl}`,
      subject: `New Splunk On-Call Voicemail from: ${event.From}`,
    };
  }
  else{
    // Define message params
      msg = {
      to: context.TO_EMAIL_ADDRESS,
      from: context.FROM_EMAIL_ADDRESS,
      text: `New Splunk On-Call Voicemail from: ${event.From}\n Recording URL is: ${event.RecordingUrl}`,
      subject: `New Splunk On-Call Voicemail from: ${event.From}`,
    };
  }
  // Send message
  sgMail.send(msg)
  .then(() => {console.log("email successful");}, error => {
    console.log("Email Failed.", error.response.body);
  });
}

// Posts information to VictorOps that generates alerts that show up in the timeline
function postToVictorOps (event, context, payload) {
  return new Promise((resolve, reject) => {
    const {ALERT_HOST, messages, VICTOROPS_TWILIO_SERVICE_API_KEY, NO_VOICEMAIL, VM_EMAIL} = context;
    const {CallSid, CallStatus, TranscriptionStatus, TranscriptionText,ParentCallSid, DialCallStatus} = event;
    const {callAnsweredByHuman, detailedLog, goToVM, phoneNumber, realCallerId, teamsArray, voice, entityId} = payload;
    const alert = {
      monitoring_tool: 'Twilio',
      entity_id: CallSid,
      entity_display_name: 'Twilio Live Call Routing Details',
      caller_id: realCallerId
    };
    // If they're going straight to VM and no voicemail is set, just create the incident
    if (goToVM === true && NO_VOICEMAIL.toLowerCase() === 'true') {
      alert.monitoring_tool = 'Twilio';
      alert.message_type = 'critical';
      alert.state_message = messages.voCallNotAnswered(realCallerId);
    // Create an incident in VictorOps if Twilio was able to transcribe caller's message
    } else if (!(_.isUndefined(TranscriptionText)) && TranscriptionText !== '') {
      alert.message_type = 'critical';
      alert.entity_display_name = goToVM === true
        ? messages.voTwilioMessageDirect(teamsArray[0].name)
        : messages.voTwilioMessageAfter(teamsArray[0].name);
      alert.state_message = messages.voTwilioTransciption(TranscriptionText, detailedLog);
        if (VM_EMAIL && VM_EMAIL.toLowerCase() === 'true'){
          emailVoicemailLink(event, context, true);
        };
    // Create an incident in VictorOps if Twilio was unable to transcribe caller's message
    } else if (TranscriptionStatus == 'failed') {
      alert.message_type = 'critical';
      alert.entity_display_name = goToVM === true
        ? messages.voTwilioMessageDirect(teamsArray[0].name)
        : messages.voTwilioMessageAfter(teamsArray[0].name);
      alert.state_message = messages.voTwilioTransciptionFail(detailedLog);
        if (VM_EMAIL && VM_EMAIL.toLowerCase() === 'true') {
          emailVoicemailLink(event, context, false);
        };
    // Create an 'Acknowledgement' alert in VictorOps when caller is connected with on-call person
    } else if (callAnsweredByHuman === true) {
      alert.message_type = 'acknowledgement';
      alert.state_message = messages.voCallAnswered(phoneNumber.user, realCallerId, detailedLog);
      alert.ack_author = phoneNumber.user;
      alert.entity_id = ParentCallSid;
    // Create a 'Recovery' alert in VictorOps when caller and on-call person complete their call
    } else if (DialCallStatus === 'completed' && TranscriptionStatus !== 'failed') {
      alert.message_type = 'recovery';
      alert.state_message = messages.voCallCompleted(phoneNumber.user, realCallerId, detailedLog);
      alert.ack_author = phoneNumber.user;
      alert.entity_id = entityId;
    } else if (CallStatus === 'in-progress' && NO_VOICEMAIL.toLowerCase() === 'true') {
      alert.monitoring_tool = 'Twilio';
      alert.message_type = 'critical';
      alert.state_message = messages.voCallNotAnswered(realCallerId);
    } else {
      resolve('');
      return;
    }
    log('postToVictorOps', event);
    got.post(
      `https://${ALERT_HOST}/integrations/generic/20131114/alert/${VICTOROPS_TWILIO_SERVICE_API_KEY}/${teamsArray[0].slug}`,
      {
        json: true,
        headers: {'Content-Type': 'application/json'},
        body: alert
      }
    )
    .then(response => {
      const twiml = new Twilio.twiml.VoiceResponse();
      twiml.say(
        {voice},
        `${messages.otherPartyDisconnect} ${messages.goodbye}`
      );
      resolve(DialCallStatus == 'completed' && TranscriptionStatus !== 'failed' ? twiml : '');
    })
    .catch(err => {
      console.log(err);
      resolve('');
    });
  });
}
