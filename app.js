require('dotenv').config();
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var helmet = require('helmet');

require('./models/connection');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var organizersRouter = require('./routes/organizers');
var eventsRouter = require('./routes/events');
var financesRouter = require('./routes/finances');

var app = express();

app.set('trust proxy', 1);

const limiter = require('./limiter');

app.use(limiter);

app.use(helmet()); 

app.use(helmet.contentSecurityPolicy({
    directives: {
        defaultSrc: ["'self'"],  
        scriptSrc: ["'self'"],  
        objectSrc: ["'none'"],  
        upgradeInsecureRequests: [],  
        imgSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],  
    }
}));

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/organizers', organizersRouter);
app.use('/events', eventsRouter);
app.use('/finances', financesRouter);

module.exports = app;