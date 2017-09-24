'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const yargs = require('yargs');
const shortid = require('shortid');
const qs = require('querystring');
const {URL} = require('url');
const cookieParser = require('cookie-parser');
const config = require('./configure');
const request = require('request');
const exhb = require('express-handlebars');
const session = require('express-session');
const AWS = require('aws-sdk');

/**
 * Panic! Something terrible happned. Print error to console and die.
 * @param {*} err 
 */
const freakOut = (err) => {
    console.log('PANIC!');
    console.error(err);
    process.exit(1);
}

/**
 * Generates the Google OAuth redirect URI for clients.
 */
const getGoogleRedirectUri = () => {
    return 'http://'+baseUrl+'/auth/gg/redirect';
}

const args = yargs
    .option('port', {
        alias: 'P', 
        describe: 'A port to bind to', 
        default: 8080, 
        type: 'number'})
    .option('base_url', {
        alias: 'H',
        describe: 'Publicly routable hostname of app, needed for oauth redirect urls',
        default: 'localhost:$port',
        type: 'string'
    })
    .argv;


const api = express.Router();
const baseUrl = args.base_url.replace('$port', args.port);


const getAwsCredsForGoogleIdToken = (googleIdToken) => {
    return new Promise((resolve, reject) => {

        const sts = new AWS.STS();
        const params = {
            DurationSeconds: 3600,
            // ProviderId: 'accounts.google.com',
            RoleArn: 'arn:aws:iam::808510826174:role/WebIdDemoOneGoogleUser',
            RoleSessionName: 'aws-webid-demo',
            WebIdentityToken: googleIdToken
        };
    
        sts.assumeRoleWithWebIdentity(params, (err, data) => {
            if (err) reject(err);
            else resolve({
                accessKeyId: data.Credentials.AccessKeyId, 
                secretAccessKey: data.Credentials.SecretAccessKey
            });
        });
    });
}

/**
 * Resolve with AWS creds stored in session or request new ones if none are present.
 * @param {*} session 
 */
const getAwsConfigFromSession = (session) => {
    if (session.awsConfig) {
        return Promise.resolve(session.awsConfig);
    } else {
        return getAwsCredsForGoogleIdToken(session.googleIdToken).then(credentials => {
            session.awsConfig = Object.assign({}, credentials, {region: config.awsRegion});
        });
    }
}


const listS3Ojects = (awsConfig) => {

    console.log('awsConfig', awsConfig);

    const s3 = new AWS.S3(awsConfig);
    const params = {Bucket: config.awsS3BucketName};

    return new Promise((resolve, reject) => {
        s3.listObjects(params, (err, data) => {
            if (err) reject(err);
            else resolve(data);
        })
    });
}

api.get('/s3/list', (req, res, next) => {

    if (!req.session.isAuthenticated) {
        res.status(403).json({message: 'Please login first'});
        return;
    }

    getAwsConfigFromSession(req.session)
        .then(config => {
            return listS3Ojects(config);
        })
        .then(result => {
            const data = result.Contents.map(entry => entry.Key);
            res.status(200).json({entries: data});
        })
        .catch(next);
});

api.use((req, res, next) => {
    res.status(404).json({message: 'Nothing be here mate!'});
});

api.use((err, req, res, next) => {
    console.error('API error', err);
    res.status(500).json({message: err.message || 'Shit went down'});
});

const auth = express.Router();


/**
 * Initiates the Google OAuth flow by redirecting the user to Googles' auth endpoint.
 * Handled by the backend so we can generate a XSRF token and store it in the session.
 */
auth.get('/gg/flow', (req, res, next) => {

    // in real life we would use the discovery document:
    // https://developers.google.com/identity/protocols/OpenIDConnect#discovery
    const endPoint = 'https://accounts.google.com/o/oauth2/v2/auth';

    // stateToken will need to be validated when we receive the access code in the next step
    const stateToken = shortid();

    // redirect the user to googles authorization endpoint
    const query = qs.stringify({
        client_id: config.googleClientId,
        response_type: 'code',
        redirect_uri: getGoogleRedirectUri(),
        state: stateToken,
        scope: 'openid email'
    });

    req.session.googleAuthState = stateToken;

    const redirectUrl = endPoint+'?'+query;
    res.redirect(redirectUrl);
});


/**
 * Google OAuth redirect URL implementation. We receive an access code that we can use in
 * conjunction with the client secret to receive the actual access token. We also receive and
 * validate the state token we sent with the earlier request.
 */
auth.get('/gg/redirect', (req, res, next) => {

    if (!req.session.googleAuthState || req.session.googleAuthState != req.query.state) {
        console.warn('Invalid or missing state token');
        res.status(200).end(); // play dead
        return;
    }

    // clear auth state
    req.session.googleAuthState = undefined;

    console.log('Incoming google oauth redirect');
    console.log('Access code:', req.query.code);

    // exchange access code for access token
    const tokenEndpoint = 'https://www.googleapis.com/oauth2/v4/token';
    const data = {
        code: req.query.code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: getGoogleRedirectUri(),
        grant_type: 'authorization_code'
    };

    request.post(tokenEndpoint, {form: data}, (err, res2, body) => {
        if (err) next(err);
        else {
            // TODO: try to decode body.id_token
            const data = JSON.parse(body);
            console.log('Received Google access token:', data.access_token);
            req.session.isAuthenticated = true;
            req.session.googleAccessToken = data.access_token;
            req.session.googleIdToken = data.id_token;
            res.redirect('/');
        }
    });
});


const frontend = express.Router();

frontend.get('/', (req, res, next) => {
    res.render('home', {
        message: 'A message from handlebars',
        isAuthenticated: req.session.isAuthenticated
    });
});


console.info('Using port '+args.port);
console.info('Using base url '+baseUrl);

const app = express();

app.use(bodyParser.json());
// app.use(cookieParser());
app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false
}));

app.engine('.html', exhb({defaultLayout: 'main', extname: '.html'}));
app.set('view engine', '.html');

app.use('/api', api);
app.use('/auth', auth);
app.use('/', frontend);
app.use(express.static(__dirname+'/public'));

app.listen(args.port, (err) => {
    if (err) console.log('oops!');
    else console.info('Ready on :'+args.port)
});
