var express = require('express');
var router = express.Router();
const uid2 = require("uid2");
const bcrypt = require("bcrypt");
const User = require("../models/users");
const Transfer = require('../models/transfers')
const Status = require('../models/status')
const Event = require('../models/events')
const Reimburses = require('../models/reimburses')

const limiter = require('../limiter')

const Sender = require("mailersend").Sender;
const Recipient = require("mailersend").Recipient;
const EmailParams = require("mailersend").EmailParams;
const { MailerSend } = require("mailersend");

const mailerSend  = new MailerSend({
  apiKey: "mlsn.cb35e7e3e4df13671317cef2750ed1aca8227adb8f9abac599674f5464a45584",
});

const cloudinary = require('cloudinary').v2;


cloudinary.config({
  cloud_name: 'dqr6dghcl',
  api_key: '752741783166574',
  api_secret: '7HNh_PCm0PsWUAa_vlyJtpYoFoc'
  });


/* Signup */
router.post("/signup", limiter, async (req, res) => {

  try {
    if (!req.body.password || !req.body.email ||!req.body.pseudo ||!req.body.name) {
      return res.json({ result: false, error: "Missing or empty fields" });
    }
    
    const existingUsers = await User.find({ email: req.body.email });
    
    // Vérifier si au moins un des utilisateurs avec cet e-mail est ouvert
    const isOpenExists = existingUsers.some(user => user.isOpen);

    if (existingUsers.length > 0 && isOpenExists) {
      return res.json({ result: false, error: 'Email already exists' });
    }

    const hash = bcrypt.hashSync(req.body.password, 10);

    let dateOfBirth =  new Date(2000, 0, 1)

    if(req.body.date){
      dateOfBirth = new Date(req.body.date)
    }

    let pictureProfile = "https://res.cloudinary.com/dqr6dghcl/image/upload/v1709972669/Coinpack/Group_46_1_isxhjs.png"

    if(req.body.picture){
      pictureProfile = req.body.picture
    }

    const newUserData = {
      pseudo: req.body.pseudo,
      name: req.body.name,
      picture: pictureProfile,
      birthDate: dateOfBirth,
    };

    
    const newUser = new User({
      token: uid2(32),
      email: req.body.email,
      password: hash,
      language: req.body.language,
      isOpen : true,
      isActive: true,
      isConditions : req.body.isConditions,
      isMailing : true,
      dateCreation: new Date(),
      userData: newUserData,
      isStats: true,
      saldoOthersData : []
    });

    await newUser.save();

    const sentFrom = new Sender("hello@coinpack.eu", "Thomas of Coinpack");

    const recipients = [new Recipient(`${req.body.email}`, `${req.body.name}`)];

    const personalization = [
      {
        email: req.body.email,
        data: {
          firstname: req.body.name
        },
      }
    ];
    
    const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setTemplateId('3z0vklonm7147qrx')
        .setPersonalization(personalization);

        mailerSend.email
        .send(emailParams)
        .then((response) => console.log(response))
        .catch((error) => console.log(error));

        return res.json({ result: true, message : "User signed up", data : newUser });
      } catch (error) {
        console.error(error);
        return res.json({ result: false, error: "An error occurred" });
      }
});


// Signin

router.post('/login', limiter, (req, res) => {
  if (!req.body.email || !req.body.password) {
    return res.json({ result: false, error: 'Missing or empty fields' });
  }

  const query = {
    $or: [
      { email: req.body.email },
      { 'userData.pseudo': req.body.email }
    ]
  };

  User.find(query)
    .then(users => {
      const openUser = users.find(user => user.isOpen);

      if (openUser && bcrypt.compareSync(req.body.password, openUser.password)) {
        return res.json({ result: true, message: "User logged in", db: openUser});
      } else {
        return res.json({ result: false, error: "Email, pseudo, or password incorrect" });
      }
    })
    .catch(error => {
      return res.json({ result: false, error: error.message });
    });
});





// Get info of user

router.post('/getInfoUser', limiter, (req, res) => {
  if (!req.body.tokenUser) {
    res.json({ result: false, error: 'Missing or empty fields' });
    return;
  }

  User.findOne({ token: req.body.tokenUser })
    .populate({
      path: 'saldoOthersData.saldoInfo',
      model: 'saldos',
      populate: [
        {
          path: 'event',
          model: 'events',
          select: '_id nameEvent pictureEvent' 
        },
        {
          path: 'organizer', 
          model: 'organizers',
          select: '_id name picture' 
        }
      ]
    })
    .then(data => {
      if (data) {
        res.json({ result: true, message: "User found", db: data });
      } else {
        res.json({ result: false, error: "No user found" });
      }
    })
    .catch(error => {
      res.json({ result: false, error: error.message });
    });
});





// change info of user

router.post('/updateUserInfo', limiter, (req, res) => {
  const { token, email, language, pseudo, picture, name, isSwitch, birthdateInfo } = req.body;
  
  if (!token) {
    return res.json({ result: false, error: 'Missing token field' });
  }

  // Créer un objet contenant uniquement les champs modifiables
  const updatedInfo = {};
  if (email) updatedInfo.email = email;
  if (language) updatedInfo.language = language;
  updatedInfo.isStats = isSwitch;
  if (pseudo) updatedInfo["userData.pseudo"] = pseudo;
  if (picture) updatedInfo["userData.picture"] = picture;
  if (name) updatedInfo["userData.name"] = name;
  if (birthdateInfo) updatedInfo["userData.birthDate"] = birthdateInfo


  User.findOneAndUpdate({ token: token }, updatedInfo, { new: true })
    .then(updatedUser => {
      if (updatedUser) {
        return res.json({ result: true, message : "Data updated", data : updatedUser });
      } else {
        return res.json({ result: false, error: 'User not found' });
      }
    })
    .catch(error => {
      return res.json({ result: false, error: error.message });
    });
});


// change Password

router.post('/changePassword', limiter, async (req, res) => {
  const { token, oldPassword, newPassword } = req.body;
  
  if (!token || !oldPassword || !newPassword) {
    return res.json({ result: false, error: 'Missing fields' });
  }

  try {
    const user = await User.findOne({ token });
    if (!user) {
      return res.json({ result: false, error: 'User not found' });
    }

    // Vérifier si l'ancien mot de passe correspond
    if (!bcrypt.compareSync(oldPassword, user.password)) {
      return res.json({ result: false, error: 'Old password is incorrect' });
    }

    // Hasher et sauvegarder le nouveau mot de passe
    user.password = bcrypt.hashSync(newPassword, 10);
    
    await user.save();
    return res.json({ result: true, message: 'Password updated successfully' });

  } catch (error) {
    return res.json({ result: false, error: error.message });
  }
});


// get info user

router.post('/getInfoUserFinancial', limiter, (req, res) => {
  if (!req.body.tokenUser) {
    res.json({ result: false, error: 'Missing or empty fields' });
    return;
  }

  User.findOne({ token: req.body.tokenUser })
    .populate({
      path: 'saldoOthersData.saldoInfo',
      model: 'saldos'
    })
    .populate({
      path: 'saldoOthersData.transactions',
      model: 'transactions',
      populate: [
        { path: 'event', model: 'events', select: 'nameEvent pictureEvent timezone' },
        {
          path: 'saldo',
          model: 'saldos',
          select: 'name type'
        },
      ]
    })
    .populate({
      path: 'saldoOthersData.deposit',
      model: 'deposits',
      populate: { path: 'coin', model: 'saldos', select:'name type' }
    })
    .populate({
      path: 'saldoOthersData.refund',
      model: 'reimburses',
      populate: { path: 'saldo', model: 'saldos', select: 'name type' }
    })
    .populate({
      path: 'saldoOthersData.transfers',
      model: 'transfers',
      populate: [
        { path: 'sender', model: 'users', select: 'userData.pseudo' }, // Removed 'token' from select
        { path: 'receiver', model: 'users', select: 'userData.pseudo' }, // Removed 'token' from select
        { path: 'saldo', model: 'saldos', select: 'name type'},
      ]
    })
    .exec()
    .then(data => {
      if (data) {
        // Convertir en objet simple pour pouvoir modifier facilement
        const result = data.toObject();

        // Supprimer les informations sensibles de l'utilisateur principal
        delete result._id;
        delete result.token;
        delete result.email;
        delete result.password;
        delete result.language;
        delete result.isOpen;
        delete result.isActive;
        delete result.isConditions;
        delete result.isMailing;
        delete result.dateCreation;
        delete result.userData;
        delete result.isStats;
        delete result.events;
        delete result.__v;

        // Parcourir les transferts et ajouter senderIsUser: true ou false
        result.saldoOthersData.forEach(saldo => {
          saldo.transfers.forEach(transfer => {
            transfer.senderIsUser = transfer.sender.pseudo === req.body.tokenUser;
          });
        });

        res.json({ result: true, message: "User found", db: result });
      } else {
        res.json({ result: false, error: "No user found" });
      }
    })
    .catch(error => {
      res.json({ result: false, error: error.message });
    });
});

// put account on isOpen false

router.post('/closeAccount', limiter, (req, res) => {
  const { tokenUser } = req.body;

  if (!tokenUser) {
    return res.json({ result: false, error: 'Missing tokenUser field' });
  }

  User.findOneAndUpdate(
    { token: tokenUser },
    { isOpen: false },
    { new: true }
  )
  .then(updatedUser => {
    if (updatedUser) {
      return res.json({ result: true, message: 'Account closed successfully' });
    } else {
      return res.json({ result: false, error: 'User not found' });
    }
  })
  .catch(error => {
    return res.json({ result: false, error: error.message });
  });
});


// set a random password and send email with send grid

router.post('/sendNewPassword', limiter, (req, res) => {

  User.findOne({email: req.body.email }).then((data) => {
    if(!data){
      res.json({result : false, error : "no email found"})
    } else {

      const firstnameData = data.userData.name

      const temporaryPassword = uid2(5)
     

      const sentFrom = new Sender("hello@coinpack.eu", "Thomas of Coinpack");

      const recipients = [new Recipient(`${req.body.email}`, firstnameData)];

      const personalization = [
        {
          email: req.body.email,
          data: {
            firstname: firstnameData,
            password : temporaryPassword
          },
        }
      ];
      
      const emailParams = new EmailParams()
          .setFrom(sentFrom)
          .setTo(recipients)
          .setTemplateId('3zxk54v79814jy6v')
          .setPersonalization(personalization);

          mailerSend.email
          .send(emailParams)
          .then((response) => console.log(response))
          .catch((error) => console.log(error))


      const hash = bcrypt.hashSync(temporaryPassword, 10)
    
      User.updateOne({email: req.body.email }, {password : hash})
      .then(() => {
          res.json({ result: true, message :'email sent' });
        })
    } 
})
})


// check if pseudo already exist

router.post('/checkPseudo', limiter, (req, res) => {

  User.findOne({"userData.pseudo" : req.body.pseudo }).then((data) => {
    if(data){
      res.json({ result: true, message :'pseudo already exists' });
    } else {
      res.json({ result: false, message :'pseudo doesnt already exist' });
    }
  })
})


// test with limited people

router.get('/checkNumber', limiter, async (req, res) => {
  try {
    const status = await Status.findOne();
    const limit = status.limitUser;
    const count = await User.countDocuments();

    if (count < limit) {
      res.json({ result: true, message: 'Still space for users' });
    } else {
      res.json({ result: false, message: 'No more users possible' });
    }
  } catch (error) {
    console.error('Error fetching status or counting users:', error);
    res.status(500).json({ result: false, message: 'Error checking user count' });
  }
});



/* Change profile picture */
router.post('/updateProfilePicture', limiter, async (req, res) => {
  const { token, picture } = req.body;

  if (!token || !picture) {
    return res.json({ result: false, error: 'Missing fields' });
  }

  try {
    const user = await User.findOne({ token });
    if (!user) {
      return res.json({ result: false, error: 'User not found' });
    }

    // Update user's profile picture URL
    user.userData.picture = picture;
    await user.save();

    return res.json({ result: true, message: 'Profile picture updated successfully', picture: picture });
  } catch (error) {
    console.error(error);
    return res.json({ result: false, error: 'An error occurred while updating profile picture' });
  }
});

// search other user

router.post('/searchUsers', async (req, res) => {
  const { query, token } = req.body;

  if (!query) {
    return res.json({ result: false, error: 'Missing query parameter' });
  }

  if (!token) {
    return res.json({ result: false, error: 'Missing token parameter' });
  }

  try {
    // Recherche des utilisateurs correspondant à l'email, pseudo ou nom
    const users = await User.find({
      isActive: true,
      isOpen: true,  
      token: { $ne: token },
      $or: [
        { email: { $regex: query, $options: 'i' } },
        { 'userData.pseudo': { $regex: query, $options: 'i' } },
        { 'userData.name': { $regex: query, $options: 'i' } }
      ]
    })
    .limit(5)
    .select('_id userData.pseudo userData.name userData.picture');

    res.json({ result: true, users });
  } catch (error) {
    console.error('Erreur lors de la recherche des utilisateurs :', error);
    res.status(500).json({ result: false, error: 'Une erreur est survenue lors de la recherche des utilisateurs' });
  }
});

// toggle favorite event user

router.post('/toggleFavoriteEvent', async (req, res) => {
  const { token, eventId } = req.body;

  if (!token || !eventId) {
    return res.json({ result: false, error: 'Missing token or eventId' });
  }

  try {
    const user = await User.findOne({ token });

    if (!user) {
      return res.json({ result: false, error: 'User not found' });
    }

    const eventIndex = user.favoriteEvents.indexOf(eventId);

    if (eventIndex === -1) {
      // Event is not in favorites, add it
      user.favoriteEvents.push(eventId);
    } else {
      // Event is in favorites, remove it
      user.favoriteEvents.splice(eventIndex, 1);
    }

    await user.save();

    // Populate favorite events after saving
    const populatedUser = await User.findOne({ token }).populate({
      path: 'favoriteEvents',
      match: {
        isVisible: true,
        isActive: true,
        isActiveAdmin: true,
      },
      select: '-priceToken',
      populate: [
        { path: 'organizer', select: '_id name picture userData' },
        { path: 'saldoEvent', select: '-priceToken' },
      ],
      options: { sort: { startDateEvent: 1 } },
    });

    return res.json({ result: true, message: 'Favorite events updated', favoriteEvents: populatedUser.favoriteEvents });
  } catch (error) {
    console.error('Error toggling favorite event:', error);
    return res.status(500).json({ result: false, error: 'An error occurred while toggling favorite event' });
  }
});



// get favorite events from user 

router.post('/getFavoriteEvents', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.json({ result: false, error: 'Missing token' });
  }

  try {
    const user = await User.findOne({ token }).populate({
      path: 'favoriteEvents',
      match: {
        isVisible: true,
        isActive: true,
        isActiveAdmin: true,
      },
      select: '-priceToken',
      populate: [
        { path: 'organizer', select: '_id name picture userData' },
        { path: 'saldoEvent', select: '-priceToken' },
      ],
      options: { sort: { startDateEvent: 1 } },
    });

    if (!user) {
      return res.json({ result: false, error: 'User not found' });
    }

    res.json({ result: true, favoriteEvents: user.favoriteEvents });
  } catch (error) {
    console.error('Error:', error);
    res.json({ result: false, error: 'An error occurred while fetching favorite events' });
  }
});

module.exports = router;
