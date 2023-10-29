var express = require('express');
var router = express.Router();
const Event = require("../models/events");
const Organizer = require("../models/organizers")
const User = require("../models/users")




// search events



router.get('/search', async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Mettre l'heure à 00:00:00

  const searchText = req.query.q;

  try {
    const eventResults = await Event.find({
      nameEvent: { $regex: searchText, $options: 'i' },
      endDateEvent: { $gte: today } // endDateEvent doit être supérieure ou égale à la date d'aujourd'hui (sans tenir compte de l'heure)
    })
      .populate('organizer')
      .populate('saldoEvent');

    const organizerResults = await Organizer.find({ name: { $regex: searchText, $options: 'i' } });

    res.json({ eventResults, organizerResults });
  } catch (error) {
    console.error('Error searching events and organizers', error);
    res.status(500).json({ error: 'An error occurred while searching events and organizers' });
  }
});




  // get all events for which 

  router.get('/eventsUpcoming', async (req, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);  // Met à 00:00:00 pour comparer uniquement les jours
  
      const upcomingEvents = await Event.find({
        endDateEvent: { $gte: today }     
      })
      .populate('organizer')
      .populate('saldoEvent');
  
      res.json({ result: true, upcomingEvents });
    } catch (error) {
      console.error('Error:', error);
      res.json({ result: false, error: "An error occurred while fetching upcoming events" });
    }
  });
  


  // add event to user

router.post('/addEvent', (req, res) => {
  if (!req.body.eventId || !req.body.tokenUser) {
    return res.json({ result: false, error: 'Missing or empty fields' });
  }

  // Vérifier si l'événement est déjà associé à l'utilisateur
  User.findOne({ token: req.body.tokenUser, events: req.body.eventId })
    .then(existingUser => {
      if (existingUser) {
        return res.json({ result: true, message: 'Event already associated with the user' });
      } else {
        // Ajouter l'événement à l'utilisateur
        return User.findOne({ token: req.body.tokenUser })
          .then(user => {
            if (user) {
              user.events.push(req.body.eventId);
              return user.save(); // Sauvegarder les modifications apportées à l'utilisateur
            } else {
              return res.json({ result: false, error: 'User not found' });
            }
          })
          .then(savedUser => {
            return res.json({ result: true, user: savedUser });
          })
          .catch(error => {
            return res.json({ result: false, error: error.message });
          });
      }
    })
    .catch(error => {
      return res.json({ result: false, error: error.message });
    });
});




// Get all event of user


router.post('/eventByUser', (req, res) => {
  if (!req.body.tokenUser) {
    return res.json({ result: false, error: 'Missing or empty fields' });
  }

  // Vérifier si l'événement est déjà associé à l'utilisateur
  User.findOne({ token: req.body.tokenUser})
    .populate({
      path: 'events',
      populate : {
        path: 'organizer'
      }})
    .then(data => {
      if(data){
        return res.json({ result: true, message: 'Events found', data : data })
      } else {
        return res.json({ result: false, message: 'No Event found' })
      }
    })
});
  
  module.exports = router;