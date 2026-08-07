# Uber Clone

> A polished ride-hailing mobile application built with Expo, React Native, Clerk, Stripe, and Google Maps.

## Project Overview

This repository contains a cross-platform ride-booking app inspired by modern mobility experiences. It demonstrates:

- A clean onboarding and authentication flow using Clerk
- Location-based ride discovery with Google Places and Maps integration
- Driver selection and ride booking experience
- Secure checkout and payment handling with Stripe
- Persistent app state with Zustand and secure token storage
- A route-based mobile UI built with Expo Router and React Navigation

The app is structured to keep navigation, UI components, state management, and API integration clearly separated.

## Key Technologies

- Expo / Expo Router
- React Native / TypeScript
- Clerk for authentication
- Stripe React Native and server-side Stripe APIs
- Google Places and Google Maps APIs
- Neon Serverless Postgres via @neondatabase/serverless
- Zustand, NativeWind, and React Navigation

## Project Structure

- app/ — main screens and file-based navigation
- components/ — reusable UI, map, payment, and input components
- lib/ — authentication, API helpers, and map utilities
- app/api/ — backend-style route handlers for users, rides, and Stripe payments
- store/ — global state for drivers, location, and ride flow
- types/ — shared TypeScript definitions

## Prerequisites

Before running the project, make sure you have:

- Node.js 20+ and npm
- Expo Go, an Android emulator, or an iOS simulator
- A Clerk account and publishable key
- A Stripe account and secret key
- A Neon database and connection string
- Google Maps / Places API credentials

## Environment Variables

Create a .env file in the project root and add the following values:

```env
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=your-clerk-publishable-key
EXPO_PUBLIC_SERVER_URL=http://localhost:8081
EXPO_PUBLIC_GOOGLE_API_KEY=your-google-maps-key
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=your-stripe-publishable-key
DATABASE_URL=your-neon-database-url
STRIPE_SECRET_KEY=your-stripe-secret-key
```

You can also optionally add:

```env
EXPO_PUBLIC_PLACES_API_KEY=your-google-places-key
EXPO_PUBLIC_GEOAPIFY_API_KEY=your-geoapify-key
```

## Setup Instructions

### 1. Clone the repository

```bash
git clone https://github.com/Orgitogj/Uber.git
cd Uber
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the app

```bash
npm start
```

Then open the app in one of the following:

- Expo Go
- Android emulator
- iOS simulator

## App Experience

The app currently supports:

- Sign-in and sign-up with Clerk authentication
- Pickup and destination selection using Google Places autocomplete
- Driver discovery and ride estimation on a map
- Ride booking and Stripe-based payment confirmation
- Ride history and profile management screens

## How to Review

A reviewer can verify:

- Authentication flow and protected navigation
- Location search and route setup
- Driver selection and ride booking experience
- Stripe payment initialization and confirmation
- Server-side ride and payment handling through the API routes

## GitHub

Repository: https://github.com/Orgitogj/Uber
