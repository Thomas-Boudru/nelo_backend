var express = require('express');
var router = express.Router();
const Event = require("../models/events");

const limiter = require('../limiter')

// Get event of Organizer

router.post('/getEventOrganizer', limiter, async (req, res) => {
  try {
    if (!req.body.organizerId) {
      return res.json({ result: false, error: 'Missing or empty fields' });
    }

    const today = new Date(); // Define today's date here, ensuring it's correct in your system

    const passedEvents = await Event.find({
      organizer: req.body.organizerId,
      startDateEvent: { $lt: today },
       endDateEvent: { $lt: today },
       isPermanent: false,
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
        select: 'name reimburse' 
      })
      .sort({ startDateEvent: -1 });

      const passedEventIds = passedEvents.map(event => event._id);

      const upcomingEvents = await Event.find({
        $and: [ 
          {
            $or: [
              {
                organizer: req.body.organizerId,
                _id: { $nin: passedEventIds }
                  },
              {
                organizer: req.body.organizerId,
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
          select: 'name reimburse' 
        })
        .sort({ startDateEvent: 1 });
      

    if (passedEvents.length > 0 || upcomingEvents.length > 0) {
      res.json({ result: true, passedEvents, upcomingEvents });
    } else {
      res.json({ result: false, error: 'No events found' });
    }
  } catch (error) {
    console.error('Error:', error);
    res.json({ result: false, error: "An error occurred while fetching events" });
  }
});





  
module.exports = router;