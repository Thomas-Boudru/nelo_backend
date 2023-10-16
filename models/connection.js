const mongoose = require('mongoose');

//const connectionString = process.env.CONNECTION_STRING
const connectionString = 'mongodb+srv://admin:Collinet2015@cluster0.jr2qeo0.mongodb.net/coinpack'

mongoose.connect(connectionString, {connectTimeoutMS: 2000})
.then(() => console.log('Database connected'))
.then(error => console.error(error))