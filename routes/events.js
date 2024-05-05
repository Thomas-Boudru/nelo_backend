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
      res.json({result : status.maintenance, version: status.version });
    } else {
      res.json({result : true, version: '1.0.0'}); 
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
      isVisible: true, 
      isActive: true,
      isActiveAdmin: true 
    })
      .select('-standsData')
      .populate({
        path: 'organizer',
        select: '_id name picture userData' 
      })
      .populate({
        path: 'saldoEvent',
        select: 'name' 
      });

    const organizerResults = await Organizer.find({ 
      name: { $regex: searchText, $options: 'i' },
      isActive: true 
    })
    .select('_id name picture')
      

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
      const midnight = new Date();
      today.setHours(0, 0, 0, 0);  // Met à 00:00:00 pour comparer uniquement les jours
      midnight.setHours(23, 59, 59, 999);

      const currentEvents = await Event.find({
        $and: [ 
          {
            $or: [
              {
                startDateEvent: { $lte: midnight },
                endDateEvent: { $gte: today }
              },
              {
                isPermanent: true
              }
            ]
          },
          {
            isVisible: true, 
            isActive: true,
            isActiveAdmin: true 
          }
        ]
      })
      .select('-standsData')
      .populate({
        path: 'organizer',
        select: '_id name picture userData' 
      })
      .populate({
        path: 'saldoEvent',
        select: 'name' 
      })
      .sort({ startDateEvent: 1 });
  
      const upcomingEvents = await Event.find({
        startDateEvent: { $gt: midnight },
        isPermanent: false,
        isVisible: true, 
        isActive: true,
        isActiveAdmin: true 
    })
    .populate({
      path: 'organizer',
      select: '_id name picture userData' 
    })
    .populate({
      path: 'saldoEvent',
      select: '-priceToken' 
    })
    .sort({ startDateEvent: 1 });
  
      res.json({ result: true, currentEvents, upcomingEvents});
    } catch (error) {
      console.error('Error:', error);
      res.json({ result: false, error: "An error occurred while fetching upcoming events" });
    }
  });
  
  
  router.post('/addEvent', async (req, res) => {
    const { eventId, tokenUser } = req.body;
    
    if (!eventId || !tokenUser) {
      return res.json({ result: false, error: 'Missing or empty fields' });
    }
  
    try {
      const user = await User.findOne({ token: tokenUser });
  
      if (!user) {
        return res.json({ result: false, error: 'User not found' });
      }
  
      if (user.events.includes(eventId)) {
        return res.json({ result: true, message: 'Event already associated with the user' });
      }
  
      if (user.events.length > 0) {
        return res.json({ result: false, message: 'User already has an event' });
      }
  
      user.events.push(eventId);
  
      const event = await Event.findById(eventId);
      if (event && event.saldoEvent) {
        const saldoExists = user.saldoOthersData.some(
          saldo => saldo.saldoInfo.equals(event.saldoEvent) && saldo.isActive
        );
  
        if (!saldoExists) {
          const newSaldoOtherData = {
            amount: 0,
            saldoInfo: event.saldoEvent,
            transactions: [],
            transfers: [],
            isActive: true
          };
  
          user.saldoOthersData.push(newSaldoOtherData);
        }
      }
  
      const savedUser = await user.save();
      return res.json({ result: true, message: 'Event added successfully'});
  
    } catch (error) {
      console.error('Error when adding event to user', error);
      return res.status(500).json({ result: false, error: error.message });
    }
  });


// Remove event from user
router.post('/removeEvent', async (req, res) => {
  const { eventId, tokenUser } = req.body;

  if (!eventId || !tokenUser) {
    return res.json({ result: false, error: 'Missing or empty fields' });
  }

  try {
    const user = await User.findOne({ token: tokenUser });

    if (!user) {
      return res.json({ result: false, error: 'User not found' });
    }

    // Vérifier si l'événement est dans la liste avant de tenter de le retirer
    if (!user.events.includes(eventId)) {
      return res.json({ result: false, error: 'Event not associated with the user' });
    }

    // Retirer l'événement du tableau d'événements
    user.events.pull(eventId);
    await user.save();

    return res.json({ result: true, message: 'Event removed successfully' });

  } catch (error) {
    console.error('Error when removing event from user', error);
    return res.status(500).json({ result: false, error: error.message });
  }
});



// remove saldo of event from user

router.post('/removeSaldoData', async (req, res) => {
  if (!req.body.saldoId || !req.body.tokenUser) {
    return res.json({ result: false, error: 'Missing or empty fields' });
  }

  try {
    const user = await User.findOne({ token: req.body.tokenUser });
    if (!user) {
      return res.json({ result: false, error: 'User not found' });
    }

    const saldoData = user.saldoOthersData.find(saldo => saldo._id.toString() === req.body.saldoId);
    if (!saldoData) {
      return res.json({ result: false, error: 'Saldo data not found' });
    }
    
    saldoData.isActive = false;

    const event = await Event.findOne({ saldoEvent: saldoData.saldoInfo });
    if (event) {
      user.events.pull(event._id);
    }

    // Sauvegarde des modifications
    const savedUser = await user.save();
    return res.json({ result: true, message: 'Saldo data updated and set to inactive'});
    
  } catch (error) {
    return res.json({ result: false, error: error.message });
  }
});


router.post('/eventByUser', (req, res) => {
  if (!req.body.tokenUser) {
    return res.json({ result: false, error: 'Missing or empty fields' });
  }

  // Vérifier si l'événement est déjà associé à l'utilisateur
  User.findOne({ token: req.body.tokenUser})
  .select('-_id -token -email -password -language -isOpen -isActive -isConditions -isMailing -dateCreation -userData')
  .populate({
    path: 'events',
    populate: [
      { path: 'organizer', select: '_id name picture' }, ,
      { path: 'saldoEvent'}
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