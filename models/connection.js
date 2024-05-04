/*const mongoose = require('mongoose');

const connectionString = process.env.CONNECTION_STRING

mongoose.connect(connectionString, {connectTimeoutMS: 2000})
.then(() => console.log('Database connected'))
.then(error => console.error(error))*/

const mongoose = require('mongoose');

const connectionString = process.env.CONNECTION_STRING;

// Configuration des options de connexion
const options = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    poolSize: 50, // Définissez ici la taille du pool de connexions
    connectTimeoutMS: 2000
};

mongoose.connect(connectionString, options)
.then(() => console.log('Database connected'))
.catch(error => console.error(error));