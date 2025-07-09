const axios = require('axios');
require('dotenv').config();

/**
 * Reverse geocode coordinates to get address
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @returns {Promise<string>} - Address string
 */
async function reverseGeocode(latitude, longitude) {
  try {
    // Using OpenStreetMap's Nominatim API (free and doesn't require API key)
    const response = await axios.get(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'Attendix App' // Required by Nominatim's usage policy
        }
      }
    );

    if (response.data && response.data.display_name) {
      return response.data.display_name;
    }

    return 'Address not found';
  } catch (error) {
    console.error('Error in reverse geocoding:', error);
    return 'Error getting address';
  }
}

/**
 * Alternative implementation using Google Maps API (requires API key)
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @returns {Promise<string>} - Address string
 */
async function reverseGeocodeGoogle(latitude, longitude) {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    if (!apiKey) {
      throw new Error('Google Maps API key not found');
    }

    const response = await axios.get(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${apiKey}`
    );

    if (response.data.results && response.data.results.length > 0) {
        console.log(response.data.results[0].formatted_address);
      return response.data.results[0].formatted_address;
    }

    return 'Address not found';
  } catch (error) {
    console.error('Error in Google reverse geocoding:', error);
    return 'Error getting address';
  }
}

module.exports = {
  reverseGeocode,
  reverseGeocodeGoogle
};