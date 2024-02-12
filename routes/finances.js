var express = require('express');
var router = express.Router();
const Event = require("../models/events");
const Organizer = require("../models/organizers")
const User = require("../models/users")
const Transaction = require("../models/transactions")
const Saldo = require("../models/saldos")
const Transfer = require("../models/transfers")
const Deposit = require("../models/deposits")
const fetch = require('node-fetch');

// create Payment 

{/*router.post('/paynl-transaction', async (req, res) => {
  try {
    const user = await User.findOne({ token: req.body.tokenUser });
    let lng = req.body.language
    let newDeposit;
    let saldoInput = req.body.saldoId; // Assurez-vous de récupérer la valeur correctement

    if (saldoInput) {
      newDeposit = new Deposit({
        amount: req.body.amount,
        token: req.body.tokenNumber,
        creationDate: new Date(),
        idPayment: "",
        user: user._id,
        isPaid: false,
        saldo: saldoInput,
        coin : req.body.idCoin
      });
    } else {
      res.status(500).json({ message: 'Erreur pas de saldoId' });
    }

  
      let authorizationCode = 'QVQtMDA5MC00MDY4OjE2NWVkZDA3MjZlOGNkYTUyZWI0MjVjNWU3ZGM3NmI1YTIyY2E2Yjg='
      const dataOrganizer = await Organizer.findOne({ saldoOrganizer: req.body.idCoin });
  
      if (dataOrganizer) {
        authorizationCode = dataOrganizer.authorization;
      }

      console.log('authorizationCode',authorizationCode)



    const amountToPut = req.body.amount*100

    // Attendre l'enregistrement du dépôt
    const savedDeposit = await newDeposit.save();

    const url = 'https://rest.pay.nl/v2/transactions';
    const options = {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Basic ${authorizationCode}`
      },
      body: JSON.stringify({
        stats: {object: 'Coinpack'},
        amount: { value: amountToPut, currency: 'EUR' },
        integration: { testMode: true },
        serviceId: 'SL-5893-9892', // Remplacez ceci par votre ID de service Pay.nl
        description: `CoinPack - ${req.body.saldoName}`,
        reference: `${savedDeposit._id}`, // Utilisation de l'ID du dépôt nouvellement enregistré
        returnUrl: `https://coinpack.app/statusPayment?id=${savedDeposit._id}&lng=${lng}`,
        exchangeUrl: `https://backend-coinpack-app.vercel.app/finances/paynl-status/${savedDeposit._id}/${authorizationCode}`
      })
    };

    const response = await fetch(url, options);
    const data = await response.json();
    if(data.id) {
      await Deposit.findByIdAndUpdate(savedDeposit._id, { idPayment: data.id });
    }

    res.json(data);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ message: 'Erreur lors du paiement' });
  }
});*/}



router.post('/paynl-transaction', async (req, res) => {
  try {
    const user = await User.findOne({ token: req.body.tokenUser });
    let lng = req.body.language
    let newDeposit;
    let saldoInput = req.body.saldoId; // Assurez-vous de récupérer la valeur correctement

    if (saldoInput) {
      newDeposit = new Deposit({
        amount: req.body.amount,
        token: req.body.tokenNumber,
        creationDate: new Date(),
        idPayment: "",
        user: user._id,
        isPaid: false,
        saldo: saldoInput,
        coin : req.body.idCoin
      });
    } else {
      res.status(500).json({ message: 'Erreur pas de saldoId' });
    }

  
      let authorizationCode = 'SL-5893-9892'
      const dataOrganizer = await Organizer.findOne({ saldoOrganizer: req.body.idCoin });
  
      if (dataOrganizer) {
        authorizationCode = dataOrganizer.authorization;
      }

      console.log('authorizationCode',authorizationCode)



    const amountToPut = req.body.amount*100

    // Attendre l'enregistrement du dépôt
    const savedDeposit = await newDeposit.save();

    const url = 'https://rest.pay.nl/v2/transactions';
    const options = {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Basic QVQtMDA5MC00MDY4OjE2NWVkZDA3MjZlOGNkYTUyZWI0MjVjNWU3ZGM3NmI1YTIyY2E2Yjg=`
      },
      body: JSON.stringify({
        stats: {object: 'Coinpack'},
        serviceId: `${authorizationCode}`,
        amount: { value: amountToPut, currency: 'EUR' },
        integration: { testMode: true },
        serviceId: 'SL-5893-9892', // Remplacez ceci par votre ID de service Pay.nl
        description: `CoinPack - ${req.body.saldoName}`,
        reference: `${savedDeposit._id}`, // Utilisation de l'ID du dépôt nouvellement enregistré
        returnUrl: `https://coinpack.app/statusPayment?id=${savedDeposit._id}&lng=${lng}`,
        exchangeUrl: `https://backend-coinpack-app.vercel.app/finances/paynl-status/${savedDeposit._id}/${authorizationCode}`
      })
    };

    const response = await fetch(url, options);
    const data = await response.json();
    if(data.id) {
      await Deposit.findByIdAndUpdate(savedDeposit._id, { idPayment: data.id });
    }

    res.json(data);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ message: 'Erreur lors du paiement' });
  }
});





// get status

router.get('/paynl-status/:idDeposit/:idAuthorization', async (req, res) => {
  try {
    const { idDeposit, idAuthorization  } = req.params;
    const depositFound = await Deposit.findById(idDeposit);

    if (!depositFound) {
      return res.status(404).json({ message: 'Dépôt non trouvé' });
    }

    const url = `https://rest.pay.nl/v2/transactions/${depositFound.idPayment}/status`;
    const options = {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${idAuthorization}`
      }
    };

    const response = await fetch(url, options);
    const data = await response.json();
    if (data.status.code === 100) {
      depositFound.isPaid = true;
      await depositFound.save();
     
      {/*if (!depositFound.saldo) {
        // Effectuer des mises à jour spécifiques pour le dépôt qui n'a pas de "saldo"
        await User.findByIdAndUpdate(
          depositFound.user,
          {
            // Mettre à jour les données de solde principal
            $push: { 'saldoMainData.deposit': depositFound._id },
            $inc: { 'saldoMainData.amount': depositFound.amount }
          }
        );
      } else {*/}
        // Effectuer des mises à jour spécifiques pour le dépôt ayant un "saldo"
        const saldoInfoId = depositFound.saldo._id;
        const user = await User.findById(depositFound.user);
        const saldoOtherData = user.saldoOthersData.find(s => s._id.toString() === saldoInfoId.toString());


        if (saldoOtherData) {
          // Mettre à jour un solde "saldoOtherData" existant
          await User.findOneAndUpdate(
            { _id: user._id, 'saldoOthersData._id': saldoInfoId },
            {
              $push: { 'saldoOthersData.$.deposit': depositFound._id },
              $inc: { 'saldoOthersData.$.amount': depositFound.token  }
            }
          );
        } else {
          return res.status(404).json({ message: 'Informations de solde manquantes' });
        }
      
    }

    res.status(200).json(true);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération du statut du paiement' });
  }
});

  
// Create Transaction Out


router.post("/createTransactionOut", async (req, res) => {
  let savedTransaction; // Declare the variable outside the try block.

  try {
    const userIdentity = req.body.userToken;
    const eventId = req.body.eventId;
    const saldoInfoId = req.body.saldoId;
    const numberToken = req.body.numberToken;
    const priceToken = req.body.priceToken;
    const standId = req.body.standId;
    const productsdata = req.body.products
    

    let amountToDeduct = numberToken * priceToken

    const user = await User.findOne({token : userIdentity});

    if (!user) {
      return res.json({ result: false, message: "User not found" });
    }

    {/*if (saldoInfoId) {*/}
      const saldoOtherData = user.saldoOthersData.find(
        (s) => s.saldoInfo.toString() === saldoInfoId
      );

      if (!saldoOtherData) {
        return res.json({ result: false, message: "No money deposit on this saldo" });
      }

      if (saldoOtherData.amount < numberToken) {
        return res.json({ result: false, message: "Insufficient funds" });
      }

      saldoOtherData.amount -= numberToken;
      const newTransaction = new Transaction({
        token: numberToken,
        creationDate: new Date(),
        event: eventId,
        stand:standId,
        products: productsdata,
        user: user._id,
        saldo: saldoInfoId
      });
      savedTransaction = await newTransaction.save();

      await User.findOneAndUpdate(
        { _id: user._id, 'saldoOthersData.saldoInfo': saldoInfoId },
        {
          $push: { 'saldoOthersData.$.transactions': savedTransaction._id },
          $set: { 'saldoOthersData.$.amount': saldoOtherData.amount }
        }
      );
    {/*} else {
      if (user.saldoMainData.amount < amountToDeduct) {
        return res.json({ result: false, message: "Insufficient funds" });
      }

      user.saldoMainData.amount -= amountToDeduct;
      const newTransaction = new Transaction({
        amount: -amountToDeduct,
        token: numberToken,
        priceToken: priceToken,
        creationDate: new Date(),
        event: eventId,
        stand:standId,
        user: user._id
      });
      savedTransaction = await newTransaction.save();

      await User.findByIdAndUpdate(
        user._id,
        {
          $push: { 'saldoMainData.transactions': savedTransaction._id },
          $set: { 'saldoMainData.amount': user.saldoMainData.amount }
        }
      );
    */}

    res.json({ result: true, message: "Transaction saved", transaction: savedTransaction });

  } catch (error) {
    console.error('Error:', error);
    res.json({ result: false, message: "Error saving transaction" });
  }
});






// Create Saldo / Coins type

router.post("/createSaldo", async (req, res) => {
    try {
      const newSaldo = new Saldo({
        name: req.body.saldoName,
        creationDate: new Date(),
        endDate: '2023-12-19T09:06:49.108+00:00',
        organizer : req.body.organizerId,
      });
  
      const savedSaldo = await newSaldo.save();
  
      // Now that the event is saved, let's update the Organizer
      {/*const organizerIdentity = req.body.organizerId;
  
      if (organizerIdentity) {
        await Organizer.findByIdAndUpdate(
            organizerIdentity,
          { $push: { 'saldoOrganizer': savedSaldo._id } }
        );
      } else (
          res.json({ result: false, error: "No organizer id found" })
      );*/}
      
      res.json({ result: true, message: "Saldo saved", coin: savedSaldo });
  
    } catch (error) {
      console.error('Error:', error);
      res.json({ result: false, message: "Error saving saldo" });
    }
  });
  

  // get all transactions of  events +  sum

  router.post('/getTransactionsByEvents', (req, res) => {
    if (!req.body.eventId) {
      return res.json({ result: false, error: 'Missing or empty fields' });
    }
 
    

    Transaction.find({ event: req.body.eventId})
      .then(data => {

        let sumComputation = 0
        let tokenComputation = 0

        for(element of data){
          sumComputation += -element.amount;
          tokenComputation += element.token;
        }
        if(data){
          return res.json({ result: true, message: 'Transactions found', data : data, sum : sumComputation, numUser : data.length, numToken : tokenComputation  })
        } else {
          return res.json({ result: false, message: 'No transaction found' })
        }
      })
  });

  
  module.exports = router;