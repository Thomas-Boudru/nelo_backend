var express = require('express');
var router = express.Router();
const uid2 = require("uid2");
const bcrypt = require("bcrypt");
const sgMail = require('@sendgrid/mail');
const User = require("../models/users");

/* Signup */
router.post("/signup", async (req, res) => {
  try {
    if (!req.body.password || !req.body.email ||!req.body.firstname ||!req.body.name) {
      return res.json({ result: false, error: "Missing or empty fields" });
    }
    
    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser) {
      return res.json({ result: false, error: "Email already exists" });
    }

    const hash = bcrypt.hashSync(req.body.password, 10);


    const newSaldoMain = {
      amount: 0,
      transactions : [],
      transfers: []
    };

    const newUserData = {
      firstname: req.body.firstname,
      name: req.body.name,
      picture: 'https://res.cloudinary.com/dqr6dghcl/image/upload/v1697270019/profilePicture_psfpf8.png'
    };

    
    const newUser = new User({
      token: uid2(32),
      email: req.body.email,
      password: hash,
      language: 'fr',
      isActive: true,
      isConditions : req.body.isConditions,
      isMailing : req.body.isMailing,
      dateCreation: new Date(),
      userData: newUserData,
      saldoMainData : newSaldoMain,
      saldoOthersData : []
    });

    await newUser.save();

  { /*sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    const msg = {
      to: req.body.email,
      from: 'hello@heavent.co',
      subject: 'Welcome on heavent',
      templateId: 'd-828d3d90fe1f4d82b53669bfdf5016ea',
      dynamic_template_data: {
      firstname: req.body.firstname,
    }};
  await sgMail.send(msg);*/}

    return res.json({ result: true, data : newUser });
  } catch (error) {
    return res.json({ result: false, error: "An error occurred" });
  }
});


// Signin

router.post('/login', (req,res) => {
  if (!req.body.email || !req.body.password) {
    res.json({ result: false, error: 'Missing or empty fields' });
    return;}

  User.findOne({email : req.body.email})
  .then(data => {
    if(data && bcrypt.compareSync(req.body.password, data.password)){
      res.json({ result: true, db: data})   
    } else {
      res.json({result: false, error : "Email or password"})
    } 
  })
});


// Get info of user

router.post('/getInfoUser', (req, res) => {
  if (!req.body.tokenUser) {
    res.json({ result: false, error: 'Missing or empty fields' });
    return;
  }

  User.findOne({ token: req.body.tokenUser })
    .populate({
      path: 'saldoOthersData.saldoInfo', // Peupler uniquement le champ saldoInfo de saldoOthersData
      model: 'saldos' // Remplacez 'saldos' par le nom de votre modèle de saldoInfo
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



// Get info of user financial

router.post('/getInfoUserFinancial', (req, res) => {
  if (!req.body.tokenUser) {
    res.json({ result: false, error: 'Missing or empty fields' });
    return;
  }

  User.findOne({ token: req.body.tokenUser })
    .populate({
      path: 'events', // Peupler les événements
      populate: {
        path: 'standsData.productsData', // Peupler les produits des stands
        model: 'products' // Remplacez 'products' par le nom de votre modèle de produits
      }
    })
    .populate({
      path: 'saldoMainData.transactions', // Peupler les transactions du solde principal
      model: 'transactions' // Remplacez 'transactions' par le nom de votre modèle de transactions
    })
    .populate({
      path: 'saldoMainData.transfers', // Peupler les transferts du solde principal
      model: 'transfers' // Remplacez 'transfers' par le nom de votre modèle de transferts
    })
    .populate({
      path: 'saldoOthersData.saldoInfo', // Peupler le soldeInfo de saldoOthersData
      model: 'saldos' // Remplacez 'saldos' par le nom de votre modèle de soldeInfo
    })
    .populate({
      path: 'saldoOthersData.transactions', // Peupler les transactions de saldoOthersData
      model: 'transactions' // Remplacez 'transactions' par le nom de votre modèle de transactions
    })
    .populate({
      path: 'saldoOthersData.transfers', // Peupler les transferts de saldoOthersData
      model: 'transfers' // Remplacez 'transfers' par le nom de votre modèle de transferts
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



module.exports = router;
