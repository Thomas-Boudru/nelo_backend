var express = require('express');
var router = express.Router();
const Event = require("../models/events");
const Organizer = require("../models/organizers")
const User = require("../models/users")
const Status = require("../models/status")



// check if maintenance or not


router.get('/maintenanceStatus', async (req, res) => {
  try {
    const status = await Status.findOne({});

    if (status) {
      res.json({result : status.maintenance});
    } else {
      res.json({result : true}); // Si aucun état de maintenance n'est trouvé, retourne true (ou une valeur par défaut)
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ result: false, error: "An error occurred while fetching maintenance status" });
  }
});



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

      const currentEvents = await Event.find({
        startDateEvent: { $lte: today },
        endDateEvent: { $gte: today }
      })
      .populate('organizer')
      .populate('saldoEvent');

  
      const upcomingEvents = await Event.find({
      startDateEvent: { $gt: today }
    })
    .populate('organizer')
    .populate('saldoEvent');
    
  
      res.json({ result: true, currentEvents, upcomingEvents});
    } catch (error) {
      console.error('Error:', error);
      res.json({ result: false, error: "An error occurred while fetching upcoming events" });
    }
  });
  


  // add event to user

  router.post('/addEvent', async (req, res) => {
    if (!req.body.eventId || !req.body.tokenUser) {
      return res.json({ result: false, error: 'Missing or empty fields' });
    }
  
    try {
      const existingUser = await User.findOne({ token: req.body.tokenUser, events: req.body.eventId });
  
      if (existingUser) {
        return res.json({ result: true, message: 'Event already associated with the user' });
      }
  
      const user = await User.findOne({ token: req.body.tokenUser });
  
      if (user) {
        user.events.push(req.body.eventId);
  
        const event = await Event.findById(req.body.eventId);
        
        if (event && event.saldoEvent) {
          const saldoExists = user.saldoOthersData.some((saldo) => saldo.saldoInfo.equals(event.saldoEvent));
  
          if (!saldoExists) {
            const newSaldoOtherData = {
              amount: 0,
              saldoInfo: event.saldoEvent,
              transactions: [],
              transfers: []
            };
  
            user.saldoOthersData.push(newSaldoOtherData);
          }
        }
  
        const savedUser = await user.save();
        return res.json({ result: true, user: savedUser });
      } else {
        return res.json({ result: false, error: 'User not found' });
      }
    } catch (error) {
      return res.json({ result: false, error: error.message });
    }
  });
  


// Remove event from user
router.post('/removeEvent', (req, res) => {
  if (!req.body.eventId || !req.body.tokenUser) {
    return res.json({ result: false, error: 'Missing or empty fields' });
  }

  User.findOne({ token: req.body.tokenUser })
    .then(user => {
      if (!user) {
        return res.json({ result: false, error: 'User not found' });
      }

      // Retirer l'événement de la liste des événements de l'utilisateur
      user.events.pull(req.body.eventId);

      return user.save(); // Sauvegarder les modifications apportées à l'utilisateur
    })
    .then(savedUser => {
      return res.json({ result: true, message: 'Event removed from the user', user: savedUser });
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
    populate: [
      { path: 'organizer' },
      { path: 'saldoEvent' }
    ]
  })
    .then(data => {
      if(data){
        return res.json({ result: true, message: 'Events found', data : data })
      } else {
        return res.json({ result: false, message: 'No Event found' })
      }
    })
});
  
  module.exports = router;