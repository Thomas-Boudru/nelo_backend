const mongoose = require("mongoose");

const prices = mongoose.Schema({
  number: Number,
  price: Number,
  })


const saldosSchema = mongoose.Schema({
  name: String,
  unique: Boolean,
  picture: String,
  creationDate: Date,
  endDate: Date,
  priceToken: [prices],
  priceLimit : Number,
  organizer : { type: mongoose.Schema.Types.ObjectId, ref: "organizers" },
  event : { type: mongoose.Schema.Types.ObjectId, ref: "events" },
  reimburse: Boolean
});

const Saldo = mongoose.model("saldos", saldosSchema);

module.exports = Saldo;