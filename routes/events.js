var express = require('express');
var router = express.Router();
const Event = require("../models/events");
const Organizer = require("../models/organizers")


// Create an Event

router.post("/createEvent", async (req, res) => {
  try {
      const data = await Event.findOne({ nameEvent: req.body.nameEvent });

      if (!data) {
          const newEvent = new Event({
              nameEvent: req.body.nameEvent,
              descriptionEvent: req.body.descriptionEvent,
              startDateEvent: req.body.startDateEvent,
              endDateEvent: req.body.endDateEvent,
              pictureEvent: req.body.pictureEvent,
              website: req.body.website,
              namePlace: req.body.namePlace,
              addressPlace: req.body.addressPlace,
              cityPlace: req.body.cityPlace,
              countryPlace: req.body.countryPlace,
              latitude: req.body.latitude,
              longitude: req.body.longitude,
              organizer: req.body.organizerId,
              backgroundColor : req.body.backgroundColor,
              priceToken: req.body.priceToken,
              isActive : true
          });

          const savedEvent = await newEvent.save();

          // Now that the event is saved, let's update the Organizer
          const organizerId = req.body.organizerId;
          await Organizer.findByIdAndUpdate(
              organizerId,
              { $push: { event: savedEvent._id } }
          );

          res.json({ result: true, message: "Event saved", event: savedEvent });
      } else {
          res.json({ result: false, message: "Event already exists" });
      }
  } catch (error) {
      console.error('Error:', error);
      res.json({ result: false, message: "Error saving event" });
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
    });

    // Recherche de l'organisateur en fonction du nom de l'événement
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
      });
  
      res.json({ result: true, upcomingEvents });
    } catch (error) {
      console.error('Error:', error);
      res.json({ result: false, error: "An error occurred while fetching upcoming events" });
    }
  });
  
  module.exports = router;