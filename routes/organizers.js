var express = require('express');
var router = express.Router();
const Organizer = require("../models/organizers");
const uid2 = require("uid2");
const bcrypt = require("bcrypt");
const cloudinary = require('cloudinary').v2;
const sgMail = require('@sendgrid/mail');

cloudinary.config({
  cloud_name: 'dqr6dghcl',
  api_key: '752741783166574',
  api_secret: '7HNh_PCm0PsWUAa_vlyJtpYoFoc'
});



router.post("/createOrganizer", async (req, res) => {
  try {
    const existingOrganizer = await Organizer.findOne({ "userData.name": req.body.name });
    if (existingOrganizer) {
      return res.json({ result: false, error: "Name already exists" });
    }

    const newOrganizer = new Organizer({
      name: req.body.name,
      picture: req.body.picture,
      description: req.body.description,
      website: req.body.website,
      token: uid2(32),
      isActive: true,
      isAdmin: false,
      language: req.body.language,
    });

    await newOrganizer.save();

    const payload = {
      organizerId: newOrganizer._id,
    };

    return res.json({ result: true, payload });
  } catch (error) {
    return res.json({ result: false, error: "An error occurred" });
  }
});


// create admin

router.post("/addUserData", async (req, res) => {
  try {
    const { organizerId, newUserData } = req.body;

    if (!newUserData || !organizerId || !newUserData.password) {
      return res.json({ result: false, error: "Missing organizerId, newUserData, or password" });
    }

    // Find the organizer by ID
    const organizer = await Organizer.findById(organizerId);

    if (!organizer) {
      return res.json({ result: false, error: "Organizer not found" });
    }

    // Hash the password
    const hashedPassword = bcrypt.hashSync(newUserData.password, 10);
    newUserData.password = hashedPassword;

    // Add newUserData to the existing userData
    organizer.userData.push(newUserData);
    await organizer.save();

    return res.json({ result: true, message: "UserData added successfully" });
  } catch (error) {
    return res.json({ result: false, error: "An error occurred" });
  }
});



  
module.exports = router;