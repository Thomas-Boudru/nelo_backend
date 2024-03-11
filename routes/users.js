var express = require('express');
var router = express.Router();
const uid2 = require("uid2");
const bcrypt = require("bcrypt");
const User = require("../models/users");
const Transfer = require('../models/transfers')

const Sender = require("mailersend").Sender;
const Recipient = require("mailersend").Recipient;
const EmailParams = require("mailersend").EmailParams;
const { MailerSend } = require("mailersend");

const mailerSend  = new MailerSend({
  apiKey: "mlsn.cb35e7e3e4df13671317cef2750ed1aca8227adb8f9abac599674f5464a45584",
});

/* Signup */
router.post("/signup", async (req, res) => {

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

    const newUserData = {
      pseudo: req.body.pseudo,
      name: req.body.name,
      picture: 'https://res.cloudinary.com/dqr6dghcl/image/upload/v1697270019/profilePicture_psfpf8.png'
    };

    
    const newUser = new User({
      token: uid2(32),
      email: req.body.email,
      password: hash,
      language: req.body.language,
      isOpen : true,
      isActive: true,
      isConditions : req.body.isConditions,
      isMailing : req.body.isMailing,
      dateCreation: new Date(),
      userData: newUserData,
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

        return res.json({ result: true, data: newUser });
      } catch (error) {
        console.error(error);
        return res.json({ result: false, error: "An error occurred" });
      }
});


// Signin

router.post('/login', (req, res) => {
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
      // Filtrer l'utilisateur avec isOpen à true
      const openUser = users.find(user => user.isOpen);

      if (openUser && bcrypt.compareSync(req.body.password, openUser.password)) {
        return res.json({ result: true, db: openUser });
      } else {
        return res.json({ result: false, error: "Email, pseudo, or password incorrect" });
      }
    })
    .catch(error => {
      return res.json({ result: false, error: error.message });
    });
});





// Get info of user

router.post('/getInfoUser', (req, res) => {
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
          model: 'events'
        },
        {
          path: 'organizer', // Chemin vers l'objet organizer dans le schéma saldos
          model: 'organizers' // Modèle à utiliser pour la population de l'organizer
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

router.post('/updateUserInfo', (req, res) => {
  const { token, email, language, pseudo, picture, name } = req.body;
  
  if (!token) {
    return res.json({ result: false, error: 'Missing token field' });
  }

  // Créer un objet contenant uniquement les champs modifiables
  const updatedInfo = {};
  if (email) updatedInfo.email = email;
  if (language) updatedInfo.language = language;
  if (pseudo) updatedInfo["userData.pseudo"] = pseudo;
  if (picture) updatedInfo["userData.picture"] = picture;
  if (name) updatedInfo["userData.name"] = name;

  User.findOneAndUpdate({ token: token }, updatedInfo, { new: true })
    .then(updatedUser => {
      if (updatedUser) {
        return res.json({ result: true, data: updatedUser });
      } else {
        return res.json({ result: false, error: 'User not found' });
      }
    })
    .catch(error => {
      return res.json({ result: false, error: error.message });
    });
});


// change Password

router.post('/changePassword', (req, res) => {
  const { token, oldPassword, newPassword } = req.body;
  
  if (!token || !oldPassword || !newPassword) {
    return res.json({ result: false, error: 'Missing fields' });
  }

  User.findOne({ token })
    .then(user => {
      if (!user) {
        return res.json({ result: false, error: 'User not found' });
      }
      
      // Vérifier si l'ancien mot de passe correspond
      if (!bcrypt.compareSync(oldPassword, user.password)) {
        return res.json({ result: false, error: 'Old password is incorrect' });
      }
      
      // Hasher et sauvegarder le nouveau mot de passe
      const hashedNewPassword = bcrypt.hashSync(newPassword, 10);
      user.password = hashedNewPassword;
      
      user.save()
        .then(updatedUser => {
          return res.json({ result: true, message: 'Password updated successfully' });
        })
        .catch(error => {
          return res.json({ result: false, error: error.message });
        });
    })
    .catch(error => {
      return res.json({ result: false, error: error.message });
    });
});


// Get info of user financial

router.post('/getInfoUserFinancial', (req, res) => {
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
        { path: 'event', model: 'events', select: 'nameEvent' },
        {
          path: 'saldo',
          model: 'saldos',
          select: 'name' 
        }
      ]
    })
    .populate({
      path: 'saldoOthersData.deposit',
      model: 'deposits',
      populate: { path: 'coin', model: 'saldos', select: 'name' }
    })
    .exec()
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


// put account on isOpen false

router.post('/closeAccount', (req, res) => {
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

router.post('/sendNewPassword', (req, res) => {

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

router.post('/checkPseudo', (req, res) => {

  User.findOne({"userData.pseudo" : req.body.pseudo }).then((data) => {
    if(data){
      res.json({ result: true, message :'pseudo already exists' });
    } else {
      res.json({ result: false, message :'pseudo doesnt already exist' });
    }
  })
})


// test with limited people

router.get('/checkNumber', (req, res) => {
  User.countDocuments().then((count) => {
    if(count < 1){
      res.json({ result: true, message: 'still space for users' });
    } else {
      res.json({ result: false, message: 'no more users possible' });
    }
  }).catch(error => {
    res.status(500).json({ result: false, message: 'Error checking user count' });
  });
});


module.exports = router;
