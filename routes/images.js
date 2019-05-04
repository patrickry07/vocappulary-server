const express = require('express');
const router = express.Router();
const Clarifai = require('clarifai');
var cloudinary = require('cloudinary').v2;

const app = new Clarifai.App({ apiKey: process.env.CLARIFAI_KEY });

const { db } = require('../database/models');
//Get array of probable object names for image

// temoprary translator
const googleTranslate = (word, from, to) => {
  let translationPromise = new Promise((res, rej) => {
    res(word + to);
  })
  return translationPromise();
};

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

// Flow =>
// 1.- FE -> image is taken with camera and sent as base64 encoded to cloudinary
// 2.- FE -> cloudinary sends back an image url, which is sent through HTTP to the server POST /images
// 3.- BA -> image route sends URL to clarifai to get the list of Words && image is stored in DB 
// 4.- BA -> Sent back to the server the storage id and the array of possible words
// ----------------
// 4.- FE -> user goes through array of words to confirm what the object is and sends back selected word to GET /texttospeech
// 5.- BA -> word has to be translated to language that you're learning at the moment with _____ API
// 6.- BA -> word is then encoded into ?? sent to s3, get URL 
// 7.- BA -> server sends back to client the translated word && the URL for pronunciation && also completes item table in DB


router.post('/', (req, res) => {

  let pic = req.body.base64
  let {nativeLanguage} = req.body
  cloudinary.uploader.upload(`data:image/png;base64,${pic}`, function (error, result) {
    if (error) {
      console.log(error)
    }
    else {
      const url = result.secure_url
      app.models.predict(Clarifai.GENERAL_MODEL, url)
        .then(({ outputs }) => {
          // gets the array of images from the clarifai object
          const { concepts } = outputs[0].data;
          // maps and filters the clarifai object down to the first five strings related to the image ignoring all "no person" strings
          const imagesArr = concepts.reduce((seed, conceptData) => {
            if (conceptData.name !== "no person" && seed.length < 5) {
              seed.push(conceptData.name)
            }
            return seed;
          }, []);
          // checks words returned by image and returns the words that need translations.
          db.checkWords(imagesArr, nativeLanguage)
            .then(({ completeWords, incompleteWords }) => {
              const completeTranslationPromises = completeWords.map(word => new Promise((res, rej) => {
                db.getTranslation(word.id, nativeLanguage)
                  .then(translationRow => res(translationRow));
              }));
              return Promise.all(completeTranslationPromises)
                .then(completeTranslations => {
                  // a list of promises that add a translation to each incomplete word
                  const translationPromises = incompleteWords.map(word => new Promise((res, rej) => {
                    db.getTranslation(word.id, "english")
                      .then(englishRow => 
                        googleTranslate(englishRow.text, "en", nativeLanguage)
                      )
                      .then(translatedText => 
                        db.addTranslationToWord(word.id, nativeLanguage, translatedText)
                      )
                      .then(translatedRows => {
                        res(translatedRows);
                      })
                  }));
                  return Promise.all(translationPromises)
                    .then(newlyCompleteTranslations => {
                      res.send(completeTranslations.concat(newlyCompleteTranslations));
                    });
                });
            });
        }).catch((err) => {
          console.log(err);
        });
    }
  });
//////////////////////////////////////////////////////////////////////////

});

router.post('/cloud', (req, res)=>{
  // let pic = req.body.base64
  // cloudinary.uploader.upload(`data:image/png;base64,${pic}`, function (error, result) { 
  //   if (error){
  //     console.log(error)
  //   }
  //   else{
  //     console.log(result) 
  //   }
  // });

})


module.exports = router;