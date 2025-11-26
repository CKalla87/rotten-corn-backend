/* eslint-disable @typescript-eslint/no-explicit-any */
import dotenv from 'dotenv';
import { floor, random } from 'lodash';
import axios from 'axios';
import { createCanvas } from '@napi-rs/canvas';

dotenv.config({});

function avatarColor(): string {
  const colors: string[] = [
    '#f44336',
    '#e91e63',
    '#2196f3',
    '#9c27b0',
    '#3f51b5',
    '#00bcd4',
    '#4caf50',
    '#ff9800',
    '#8bc34a',
    '#009688',
    '#03a9f4',
    '#cddc39',
    '#2962ff',
    '#448aff',
    '#84ffff',
    '#00e676',
    '#43a047',
    '#d32f2f',
    '#ff1744',
    '#ad1457',
    '#6a1b9a',
    '#1a237e',
    '#1de9b6',
    '#d84315'
  ];
  return colors[floor(random() * colors.length)];
}

function generateAvatar(text: string, backgroundColor: string, foregroundColor = 'white') {
  const canvas = createCanvas(200, 200);
  const context = canvas.getContext('2d');

  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = foregroundColor;
  context.font = 'normal 80px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  return canvas.toDataURL('image/png');
}

async function seedUserData(count: number): Promise<void> {
  // Default API URL if not set in environment
  const API_URL = process.env.API_URL || 'http://localhost:5000/api/v1';
  console.log(`Using API URL: ${API_URL}`);

  const { faker } = await import('@faker-js/faker');
  let i = 0;
  const usedUsernames = new Set<string>();
  try {
    for (i = 0; i < count; i++) {
      let username: string;
      do {
        username = faker.word.adjective({ length: { min: 5, max: 10 } });
      } while (usedUsernames.has(username));
      usedUsernames.add(username);
      const color = avatarColor();
      const avatar = generateAvatar(username.charAt(0).toUpperCase(), color);

      // Ensure color is a valid string
      if (!color || typeof color !== 'string') {
        console.error(`✗ Invalid color generated for user ${username}: ${color}`);
        continue;
      }

      const body = {
        username,
        email: faker.internet.email(),
        password: 'qwerty',
        avatarColor: color,
        avatarImage: avatar
      };

      console.log(`***ADDING USER TO DATABASE*** ${i + 1} of ${count} - ${username} (color: ${color})`);
      try {
        await axios.post(`${API_URL}/signup`, body, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        console.log(`✓ Successfully added user: ${username}`);
      } catch (requestError: any) {
        if (requestError?.response) {
          // API returned an error response
          const errorData = requestError.response.data;
          console.error(`✗ Failed to add user ${username}:`, errorData || requestError.response.statusText);
          // Debug: log what was sent if avatarColor is missing
          if (errorData?.message?.includes('Avatar color')) {
            console.error(' Debug - Request body avatarColor:', body.avatarColor);
            console.error(' Debug - Full request body keys:', Object.keys(body));
          }
        } else if (requestError?.request) {
          // Request was made but no response received
          console.error(`✗ No response from server for user ${username}. Is the API server running?`);
        } else {
          // Error setting up the request
          console.error(`✗ Error setting up request for user ${username}:`, requestError.message);
        }
      }
    }
  } catch (error: any) {
    console.error('Unexpected error:', error.message || error);
  }
}

seedUserData(10);

