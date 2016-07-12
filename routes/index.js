'use strict';

const express = require('express');
const router = express.Router();
const Promise = require('bluebird');
const rp = require('request-promise');

const baseUrl = 'https://graph.facebook.com/v2.5/';
const fieldsQs = 'id,name,cover.fields(id,source),picture.' +
  'type(large),location,events.fields(id,name,cover.fields' +
  '(id,source),picture.type(large),description,start_time,' +
  'attending_count,declined_count,maybe_count,noreply_count).since(';

router.get('/', (req, res) => {
  res.json({ 'message': 'Welcome to the Facebook Event Search service!' });
});

router.get('/events', (req, res) => {
  let query = req.query;

  if (!query.lat || !query.lng || !query.distance || !query.access_token) {
    res.status(500).send({
      error: 'Please specify the lat, lng, distance and access_token query parameters'
    });
  }
  else {
    const idLimit = 50;
    let currentTimestamp = (new Date().getTime() / 1000).toFixed();
    let venuesCount = 0, venuesWithEvents = 0, eventsCount = 0;

    const options = {
        uri: `${baseUrl}search`,
        qs: {
            access_token: query.access_token,
            type: 'place',
            center: `${query.lat}, ${query.lng}`,
            distance: query.distance,
            q: query.q || '',
            limit: 1000,
            fields: 'id'
        },
        json: true
    };

    rp.get(options).then(
      (responseBody) => {
        let ids = [];
        let tempArray = [];
        let data = responseBody.data;

        venuesCount = data.length;

          data.forEach((idObj, index, arr) => {
            tempArray.push(idObj.id);

            if (tempArray.length >= idLimit) {
              ids.push(tempArray);
              tempArray = [];
            }
          });

          if (tempArray.length > 0) {
            ids.push(tempArray);
          }

        return ids;
      }
    ).then((ids) => {
      let promises = [];

        ids.forEach((idArray, index, arr) => {
          let options = {
              uri: `${baseUrl}`,
              qs: {
                  access_token: query.access_token,
                  ids: idArray.join(','),
                  fields: fieldsQs + currentTimestamp + ')'
              }
          };

          promises.push(rp.get(options));
        });

      return promises;
    }).then((promisifiedRequests) => {
      return Promise.all(promisifiedRequests)
    })
    .then((results) => {
      let sort = query.sort.toLowerCase();
      let events = [];

      results.forEach((resStr, index, arr) => {
        var resObj = JSON.parse(resStr);

        Object.getOwnPropertyNames(resObj).forEach((venueId, index, array) => {
          let venue = resObj[venueId];

            if (venue.events && venue.events.data.length > 0) {
              venuesWithEvents++;

              venue.events.data.forEach((event, index, array) => {
                let result = {
                  venueId,
                  venueName: venue.name,
                  venueCoverPicture: (venue.cover ? venue.cover.source : null),
                  venueProfilePicture: (venue.picture ? venue.picture.data.url : null),
                  venueLocation: (venue.location ? venue.location : null),
                  eventId: event.id,
                  eventName: event.name,
                  eventCoverPicture: (event.cover ? event.cover.source : null),
                  eventProfilePicture: (event.picture ? event.picture.data.url : null),
                  eventDescription: (event.description ? event.description : null),
                  eventStarttime: (event.start_time ? event.start_time : null),
                  eventDistance: (venue.location ? (haversineDistance([venue.location.latitude, venue.location.longitude], [req.query.lat, req.query.lng], false)*1000).toFixed() : null),
                  eventTimeFromNow: calculateStarttimeDifference(currentTimestamp, event.start_time),
                  eventStats: {
                    attendingCount: event.attending_count,
                    declinedCount: event.declined_count,
                    maybeCount: event.maybe_count,
                    noreplyCount: event.noreply_count
                  }
                };

                events.push(result);
                eventsCount++;
              });
            }
        });
      });

      if (!!req.query.sort) {
        if (sort === 'time') {
          events.sort(compareTimeFromNow);
        }
        if (sort === 'distance') {
          events.sort(compareDistance);
        }
        if (sort === 'venue') {
          events.sort(compareVenue);
        }
        if (sort === 'popularity') {
          events.sort(comparePopularity);
        }
      }

      res.send({
        events,
        metadata: {
          venues: venuesCount,
          venuesWithEvents,
          events: eventsCount
        }
      });
    }).catch((e) => {
      res.status(500).send({error: e});
    });
  }
});

function calculateStarttimeDifference(currentTime, dataString) {
  return (new Date(dataString).getTime() - (currentTime * 1000 )) / 1000;
}

function compareVenue(a, b) {
  return compare(a, b, 'venueName');
}

function compareTimeFromNow(a, b) {
  return compare(a, b, 'eventTimeFromNow');
}

function compareDistance(a, b) {
  a.eventDistance = parseInt(a.eventDistance, 10);
  b.eventDistance = parseInt(b.eventDistance, 10);

  return compare(a, b, 'eventDistance');
}

function compare(valA, valB, property) {
  if (valA[property] < valB[property]) {
    return -1;
  }
  else if (valA[property] > valB[property]) {
    return 1;
  }

  return 0;
}

function comparePopularity(a, b) {
  let aStats = a.eventStats;
  let bStats = b.eventStats;

  if ((aStats.attendingCount + (aStats.maybeCount / 2)) < (bStats.attendingCount + (bStats.maybeCount / 2)))
    return 1;
  if ((aStats.attendingCount + (aStats.maybeCount / 2)) > (bStats.attendingCount + (bStats.maybeCount / 2)))
    return -1;
  return 0;
}

function haversineDistance(coordsA, coordsB, isMiles) {
  const R = 6371;

  let latA = coordsA[0];
  let lonA = coordsA[1];

  let latB = coordsB[0];
  let lonB = coordsB[1];

  function toRad(x) {
    return x * Math.PI / 180;
  }

  let x1 = latB - latA;
  let dLat = toRad(x1);
  let x2 = lonB - lonA;
  let dLon = toRad(x2);
  let a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(latA)) * Math.cos(toRad(latB)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  let d = R * c;

  if(!!isMiles) {
    d /= 1.60934;
  }

  return d;
}

module.exports = router;
