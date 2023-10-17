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
              private: req.body.private,
              allFree: req.body.free,
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

  
  module.exports = router;