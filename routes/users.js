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

module.exports = router;
