var express = require("express");
var router = express.Router();
const User = require("../models/users");
const Transaction = require("../models/transactions");
const Event = require("../models/events");
const mongoose = require("mongoose");
const limiter = require("../limiter");

const Sender = require("mailersend").Sender;
const Recipient = require("mailersend").Recipient;
const EmailParams = require("mailersend").EmailParams;
const { MailerSend } = require("mailersend");

const mailerSend = new MailerSend({
  apiKey:
    "mlsn.cb35e7e3e4df13671317cef2750ed1aca8227adb8f9abac599674f5464a45584",
});

router.post("/rankUsersByEvent", limiter, async (req, res) => {
  const { eventID } = req.body;

  if (!eventID) {
    return res.json({ result: false, error: "Missing eventID field" });
  }

  try {
    // Agrégation pour obtenir les utilisateurs avec le plus de tokens
    const topUsersByTokens = await Transaction.aggregate([
      { $match: { event: new mongoose.Types.ObjectId(eventID) } },
      { $group: { _id: "$user", totalTokens: { $sum: "$token" } } },
      { $sort: { totalTokens: -1 } },
      { $limit: 30 },
    ]);

    const userIdsByTokens = topUsersByTokens.map((user) => user._id);
    const filteredUsersByTokens = await User.find(
      { _id: { $in: userIdsByTokens }, isStats: true },
      "userData.pseudo userData.picture"
    );

    const userByIdByTokens = filteredUsersByTokens.reduce((acc, user) => {
      acc[user._id] = user;
      return acc;
    }, {});

    const populatedTopUsersByTokens = topUsersByTokens
      .filter((user) => userByIdByTokens[user._id])
      .slice(0, 20)
      .map((user) => ({
        _id: user._id,
        totalTokens: user.totalTokens,
        userData: userByIdByTokens[user._id].userData,
      }));

    // Agrégation pour obtenir les transactions avec les plus gros tokens
    const topTransactionsByTokens = await Transaction.aggregate([
      { $match: { event: new mongoose.Types.ObjectId(eventID) } },
      { $sort: { token: -1 } },
      { $group: { _id: "$user", maxToken: { $first: "$token" } } },
      { $sort: { maxToken: -1 } },
      { $limit: 20 },
    ]);

    const userIdsByTransactions = topTransactionsByTokens.map(
      (user) => user._id
    );
    const filteredUsersByTransactions = await User.find(
      { _id: { $in: userIdsByTransactions }, isStats: true },
      "userData.pseudo userData.picture"
    );

    const userByIdByTransactions = filteredUsersByTransactions.reduce(
      (acc, user) => {
        acc[user._id] = user;
        return acc;
      },
      {}
    );

    const populatedTopTransactionsByTokens = topTransactionsByTokens
      .filter((user) => userByIdByTransactions[user._id])
      .map((user) => ({
        _id: user._id,
        maxToken: user.maxToken,
        userData: userByIdByTransactions[user._id].userData,
      }));

    // Génération de l'heure actuelle en UTC
    const currentTimeUTC = new Date().toISOString();

    // Vérifier si le champ statistic et statistics est initialisé dans l'événement
    const event = await Event.findById(eventID);
    if (!event.statistic || !event.statistic.statistics) {
      event.statistic = { visible: true, statistics: {} };
    }

    // Mise à jour des statistiques dans l'événement
    event.statistic.statistics.topUsersByTokens = populatedTopUsersByTokens;
    event.statistic.statistics.topTransactionsByTokens =
      populatedTopTransactionsByTokens;
    event.statistic.statistics.generatedAtUTC = currentTimeUTC;

    // Sauvegarder l'événement mis à jour
    await event.save();

    // Retourner la réponse au client avec les données mises à jour
    res.json({
      result: true,
      topUsersByTokens: populatedTopUsersByTokens,
      topTransactionsByTokens: populatedTopTransactionsByTokens,
      generatedAtUTC: currentTimeUTC,
    });
  } catch (error) {
    console.error(error);
    res.json({
      result: false,
      error: "An error occurred while fetching user rankings",
    });
  }
});

// competition

router.post("/randomUserByEvent", limiter, async (req, res) => {
  const { eventId, numberToken, saldoId, nameEvent, competitionId } = req.body;

  if (!eventId || !numberToken || !saldoId || !competitionId) {
    return res.json({ result: false, error: "Missing required fields" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const eventObjectId = new mongoose.Types.ObjectId(eventId);
    const saldoObjectId = new mongoose.Types.ObjectId(saldoId);
    const competitionObjectId = new mongoose.Types.ObjectId(competitionId);

    // Rechercher l'événement et vérifier la compétition
    const event = await Event.findOne({
      _id: eventObjectId,
      "competition.competitions._id": competitionObjectId,
      "competition.competitions.winner": null,
    }).session(session);

    if (!event) {
      await session.abortTransaction();
      session.endSession();
      return res.json({
        result: false,
        error: "Competition already has a winner or does not exist",
      });
    }

    // Sélectionner un utilisateur au hasard parmi ceux qui participent à l'événement et ont `isStats` à true
    const users = await User.aggregate([
      { $match: { events: eventObjectId, isStats: true } },
      { $sample: { size: 1 } },
    ]);

    if (users.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.json({
        result: false,
        error: "No users found for this event",
      });
    }

    const randomUser = users[0];

    // Mettre à jour le solde du `saldoOthers` correspondant
    const updatedUser = await User.findOneAndUpdate(
      {
        _id: randomUser._id,
        "saldoOthersData.saldoInfo": saldoObjectId,
        "saldoOthersData.isActive": true,
      },
      { $inc: { "saldoOthersData.$.amount": numberToken } },
      { new: true, session }
    );

    if (!updatedUser) {
      await session.abortTransaction();
      session.endSession();
      return res.json({ result: false, error: "Failed to update user saldo" });
    }

    // Mettre à jour le champ `winner` dans la compétition
    await Event.updateOne(
      {
        _id: eventObjectId,
        "competition.competitions._id": competitionObjectId,
      },
      {
        $set: {
          "competition.competitions.$.winner": randomUser._id,
        },
      },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    // Envoi de l'email
    const sentFrom = new Sender("hello@coinpack.eu", "Thomas of Coinpack");
    const recipients = [
      new Recipient(updatedUser.email, updatedUser.userData.name),
    ];

    const personalization = [
      {
        email: updatedUser.email,
        data: {
          firstname: updatedUser.userData.name,
          eventname: nameEvent,
          tokenamount: numberToken,
        },
      },
    ];

    const emailParams = new EmailParams()
      .setFrom(sentFrom)
      .setTo(recipients)
      .setTemplateId("z86org8351k4ew13")
      .setPersonalization(personalization);

    mailerSend.email
      .send(emailParams)
      .then((response) => console.log(response))
      .catch((error) => console.log(error));

    res.json({ result: true, userId: randomUser._id });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error(error);
    res.json({
      result: false,
      error:
        "An error occurred while fetching a random user and updating saldo",
    });
  }
});

module.exports = router;
