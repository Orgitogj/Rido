import { section } from "../core";

export default section(
  {
    title: "Notifications",
    empty: "No notifications yet.",
    markAllRead: "Mark all as read",
    unread_one: "{count} unread",
    unread_other: "{count} unread",
    loadFailed: "We couldn't load your notifications.",
    unavailable: "This is no longer available.",
    category: {
      ride: "Ride",
      chat: "Chat",
      offer: "Ride request",
      account: "Account",
      support: "Support",
      safety: "Safety",
    },
    preferences: "Push preferences",
    preferencesHint:
      "These switches control push alerts only. Everything still appears here in the app, and ride status is always shown on the ride screen.",
    rideUpdates: "Ride updates",
    rideUpdatesHint: "Driver accepted, arrived, trip started and finished.",
    chatMessages: "Chat messages",
    chatMessagesHint: "New messages from your driver or passenger.",
    rideOffers: "Ride requests (drivers)",
    rideOffersHint:
      "If you switch this off you'll only see requests while the Drive screen is open.",
    accountUpdates: "Account, support and safety updates",
    accountUpdatesHint:
      "Driver application decisions, replies from support and report status.",
    saved: "Preferences saved.",
    quiet: {
      title: "Quiet hours",
      explain:
        "During quiet hours we don't send push alerts for trip receipts, card hold releases, driver application decisions, support replies or safety report updates. They still appear in this list right away, and nothing is sent in a burst afterwards.",
      critical:
        "Always sent, even in quiet hours: updates about a ride in progress (driver accepted, arrived, cancelled, no driver found, trip start), chat messages during a ride, ride requests while you're online as a driver, and reminders to confirm a scheduled ride.",
      enable: "Use quiet hours",
      start: "From",
      end: "Until",
      timeHint: "24-hour time, for example 22:00",
      timezone: "Time zone: {timezone}",
      useDeviceZone: "Use this device's time zone ({timezone})",
      overnight: "This range runs overnight, into the next day.",
      invalidTime: "Enter times as HH:MM, and make them different.",
      save: "Save quiet hours",
    },
    pushOff:
      "Push notifications are off for this device. Important updates still appear here and on the ride screen.",
    pushNeedsBuild:
      "Push notifications need a development build on Android. Updates still appear here.",
    pushUnavailable:
      "Push isn't set up on this device. Updates still appear here.",
  },
  {
    title: "Njoftimet",
    empty: "Ende pa njoftime.",
    markAllRead: "Shënoji të gjitha si të lexuara",
    unread_one: "{count} i palexuar",
    unread_other: "{count} të palexuara",
    loadFailed: "Nuk i ngarkuam dot njoftimet.",
    unavailable: "Kjo nuk është më e disponueshme.",
    category: {
      ride: "Udhëtim",
      chat: "Biseda",
      offer: "Kërkesë udhëtimi",
      account: "Llogaria",
      support: "Ndihma",
      safety: "Siguria",
    },
    preferences: "Preferencat e njoftimeve",
    preferencesHint:
      "Këta çelësa kontrollojnë vetëm njoftimet push. Gjithçka shfaqet ende këtu në aplikacion, dhe gjendja e udhëtimit shfaqet gjithmonë në ekranin e udhëtimit.",
    rideUpdates: "Përditësime të udhëtimit",
    rideUpdatesHint: "Shoferi pranoi, mbërriti, udhëtimi filloi dhe përfundoi.",
    chatMessages: "Mesazhe",
    chatMessagesHint: "Mesazhe të reja nga shoferi ose pasagjeri yt.",
    rideOffers: "Kërkesa për udhëtime (shoferët)",
    rideOffersHint:
      "Nëse e fik, kërkesat do t'i shohësh vetëm kur ekrani Drejto është i hapur.",
    accountUpdates: "Përditësime të llogarisë, ndihmës dhe sigurisë",
    accountUpdatesHint:
      "Vendime për aplikimin si shofer, përgjigje nga ndihma dhe gjendja e raporteve.",
    saved: "Preferencat u ruajtën.",
    quiet: {
      title: "Orari i qetësisë",
      explain:
        "Gjatë orarit të qetësisë nuk dërgojmë njoftime push për faturat e udhëtimeve, lirimin e bllokimit në kartë, vendimet për aplikimin si shofer, përgjigjet e ndihmës apo përditësimet e raporteve të sigurisë. Ato shfaqen menjëherë në këtë listë dhe nuk dërgohen të gjitha bashkë më pas.",
      critical:
        "Dërgohen gjithmonë, edhe në orarin e qetësisë: përditësimet për një udhëtim në vazhdim (shoferi pranoi, mbërriti, anuloi, nuk u gjet shofer, nisja e udhëtimit), mesazhet gjatë udhëtimit, kërkesat për udhëtime ndërsa je në linjë si shofer, dhe kujtesat për të konfirmuar një udhëtim të planifikuar.",
      enable: "Përdor orarin e qetësisë",
      start: "Nga",
      end: "Deri",
      timeHint: "Ora në formatin 24-orësh, për shembull 22:00",
      timezone: "Zona kohore: {timezone}",
      useDeviceZone: "Përdor zonën kohore të kësaj pajisjeje ({timezone})",
      overnight: "Ky interval vazhdon gjatë natës, deri në ditën tjetër.",
      invalidTime: "Shkruaj orët si HH:MM dhe bëji të ndryshme.",
      save: "Ruaj orarin e qetësisë",
    },
    pushOff:
      "Njoftimet push janë të fikura në këtë pajisje. Përditësimet e rëndësishme shfaqen ende këtu dhe në ekranin e udhëtimit.",
    pushNeedsBuild:
      "Njoftimet push në Android kërkojnë një version zhvillimi të aplikacionit. Përditësimet shfaqen ende këtu.",
    pushUnavailable:
      "Njoftimet push nuk janë konfiguruar në këtë pajisje. Përditësimet shfaqen ende këtu.",
  },
);
