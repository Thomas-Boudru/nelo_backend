var express = require('express');
var router = express.Router();
const User = require("../models/users");
const Transaction = require("../models/transactions");
const Event = require("../models/events");
const mongoose = require("mongoose");
const limiter = require('../limiter');

router.post('/rankUsersByEvent', limiter, async (req, res) => {
  const { eventID } = req.body;

  if (!eventID) {
    return res.json({ result: false, error: 'Missing eventID field' });
  }

  try {
    const topUsersByTokens = await Transaction.aggregate([
      { $match: { event: new mongoose.Types.ObjectId(eventID) } },
      { $group: { _id: '$user', totalTokens: { $sum: '$token' } } },
      { $sort: { totalTokens: -1 } },
      { $limit: 30 } 
    ]);

    const userIdsByTokens = topUsersByTokens.map(user => user._id);
    const filteredUsersByTokens = await User.find({ _id: { $in: userIdsByTokens }, isStats: true }, 'userData.pseudo userData.picture');

    const userByIdByTokens = filteredUsersByTokens.reduce((acc, user) => {
      acc[user._id] = user;
      return acc;
    }, {});


    const populatedTopUsersByTokens = topUsersByTokens.filter(user => userByIdByTokens[user._id])
      .slice(0, 20) 
      .map(user => ({
        _id: user._id,
        totalTokens: user.totalTokens,
        userData: userByIdByTokens[user._id].userData
      }));

    const topTransactionsByTokens = await Transaction.aggregate([
      { $match: { event: new mongoose.Types.ObjectId(eventID) } },
      { $sort: { token: -1 } },
      { $group: { _id: '$user', maxToken: { $first: '$token' } } },
      { $sort: { maxToken: -1 } },
      { $limit: 20 }
    ]);


    const userIdsByTransactions = topTransactionsByTokens.map(user => user._id);
    const filteredUsersByTransactions = await User.find({ _id: { $in: userIdsByTransactions }, isStats: true }, 'userData.pseudo userData.picture');


    const userByIdByTransactions = filteredUsersByTransactions.reduce((acc, user) => {
      acc[user._id] = user;
      return acc;
    }, {});


    const populatedTopTransactionsByTokens = topTransactionsByTokens.filter(user => userByIdByTransactions[user._id])
      .map(user => ({
        _id: user._id,
        maxToken: user.maxToken,
        userData: userByIdByTransactions[user._id].userData
      }));


    const currentTimeUTC = new Date().toISOString();


    await Event.findByIdAndUpdate(eventID, {
      $set: {
        statistic: {
          topUsersByTokens: populatedTopUsersByTokens,
          topTransactionsByTokens: populatedTopTransactionsByTokens,
          generatedAtUTC: currentTimeUTC
        }
      }
    });


    res.json({
      result: true,
      topUsersByTokens: populatedTopUsersByTokens,
      topTransactionsByTokens: populatedTopTransactionsByTokens,
      generatedAtUTC: currentTimeUTC
    });
  } catch (error) {
    console.error(error);
    res.json({ result: false, error: 'An error occurred while fetching user rankings' });
  }
});

module.exports = router;