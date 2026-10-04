import { section } from "../core";

export default section(
  {
    tabs: {
      home: "Home",
      rides: "Rides",
      chat: "Messages",
      profile: "Profile",
    },
    home: {
      welcome: "Welcome {name}",
      welcomeNoName: "Welcome",
      signOut: "Sign out",
      notifications: "Notifications",
      unread_one: "{count} unread notification",
      unread_other: "{count} unread notifications",
      rideInProgress: "Ride in progress",
      tapToOpen: "Tap to open",
      locationDenied:
        "Location permission is off. You can still book by entering a pickup address on the next screen.",
      locationUnavailable:
        "We couldn't get your location. You can retry or enter a pickup address on the next screen.",
      settings: "Settings",
      currentLocation: "Your current location",
      drive: "Drive with us",
      recent: "Recent rides",
      seeAll: "See all rides",
      loadingRides: "Loading your rides…",
      noRecent: "No recent rides yet.",
    },
    history: {
      title: "Your rides",
      empty: "No rides yet. Your requested rides will appear here.",
      refreshFailed: "Couldn't refresh your rides. Pull down to retry.",
      rideTo: "Ride to {destination}",
      status: "Status",
      requested: "Requested",
      driver: "Driver",
      simulated: "{name} (simulated)",
      charged: "Charged",
      fare: "Fare",
    },
    search: {
      placeholder: "Where do you want to go?",
      pickupPlaceholder: "Enter a pickup address",
      noKey:
        "Address search isn't configured in this build. Saved places still work.",
      noCoordinates:
        "We couldn't find coordinates for that place. Try another result.",
      failed: "Address search failed. Check your connection and try again.",
      notFound: "No matching places found.",
      timeout: "Address search timed out. Please try again.",
    },
    find: {
      title: "Ride",
      from: "From",
      to: "To",
      findNow: "Get a price",
      stopProblem:
        "One of the stops is the same place as the stop or location next to it.",
      problem: {
        PICKUP_MISSING: "Choose a pickup location.",
        DESTINATION_MISSING: "Choose a destination.",
        UNRESOLVED:
          "One of these locations couldn't be resolved. Please pick it again.",
        TOO_CLOSE: "Pickup and destination are too close together.",
      },
    },
    stops: {
      title: "Stops on the way",
      hint: "Optional. Add up to {max} stops between pickup and destination. The driver visits them in this order.",
      number: "Stop {number}",
      moveUp: "Move stop {number} earlier",
      moveDown: "Move stop {number} later",
      remove: "Remove stop {number}",
      search: "Search for a stop",
      add: "Add a stop",
      fixed:
        "Stops can't be added, removed or reordered after you request the ride.",
    },
    vehicle: {
      title: "Vehicle",
      passengers: "Passengers",
      fewer: "Fewer passengers",
      more: "More passengers",
      choosePickup:
        "Choose a pickup to see the vehicle categories offered there.",
      none: "No vehicle category is offered at this pickup right now.",
      noneForCount:
        "No vehicle category offered here seats that many passengers.",
      upTo: "Up to {count} passengers",
      nearby_one: "{count} suitable driver online nearby",
      nearby_other: "{count} suitable drivers online nearby",
      noneNearby: "No suitable drivers online nearby right now",
      estimate:
        "Counts are a live estimate of approved drivers online near the pickup, not a promise that one will accept.",
      development: "Development example",
    },
    confirm: {
      itinerary: "Trip",
      pickup: "Pickup",
      destination: "Destination",
      category: "Vehicle",
      passengers: "Passengers",
      oneFare:
        "One price covers the whole trip, including the stops. There are no waiting fees, and stops can't be changed after you request.",
      scheduledIntro:
        "This is the current price for your scheduled request. A driver is requested only after you confirm below.",
      backToScheduled: "Back to scheduled request",
      title: "Confirm your ride",
      loading: "Getting a price for your trip…",
      missing: "Pickup or destination is missing. Go back and choose both.",
      changeLocations: "Change pickup or destination",
      price: "Price",
      distance: "Route distance",
      tripTime: "Est. trip time",
      driversNearby: "Drivers online nearby",
      willOffer: "We'll offer your ride to the nearest available driver.",
      noDrivers:
        "No drivers are online near you right now. You can still request: we'll search for a short time and release the hold if nobody accepts.",
      noDriversVehicle:
        "No drivers are online near you right now. You can still request: we'll search for a short time, and there is nothing to pay if nobody accepts.",
      priceNoteVehicle:
        "This is the price you'll pay. You pay the driver by card on the driver's terminal or in cash at the end of the trip. Nothing is charged in the app.",
      priceNote:
        "This is the price you'll pay. Your card is authorized for exactly this amount when you request and charged only when the trip is completed.",
      heldFor_one: "This price is held for about {count} more minute.",
      heldFor_other: "This price is held for about {count} more minutes.",
      heldSeconds: "This price is held for less than a minute.",
      expired:
        "This price expired before you requested the ride. Nothing was charged. Get a new price to continue.",
      getNewPrice: "Get a new price",
      refresh: "Refresh price",
      priceChanged:
        "The price was {previous} and is now {current}. Review it before requesting.",
      priceSame: "Your price was refreshed and is unchanged.",
      problemTitle: {
        fallback: "Couldn't get a price",
        PICKUP_OUTSIDE_SERVICE_AREA: "Pickup is outside our service area",
        DESTINATION_OUTSIDE_SERVICE_AREA:
          "Destination is outside our service area",
        NO_ROUTE: "No drivable route",
        TRIP_TOO_SHORT: "Trip is too short",
        TRIP_TOO_LONG: "Trip is too long",
        ROUTING_UNAVAILABLE: "Couldn't calculate your route",
        ROUTING_BUSY: "Pricing is busy",
        RATE_LIMITED: "Too many price requests",
        ROUTING_NOT_CONFIGURED: "Pricing isn't available",
        PRICING_NOT_CONFIGURED: "Pricing isn't available here yet",
        NETWORK: "You're offline",
        STOP_OUTSIDE_SERVICE_AREA: "A stop is outside our service area",
        STOPS_TOO_CLOSE: "Stops are too close together",
        CATEGORY_UNAVAILABLE: "That vehicle category isn't available",
        TOO_MANY_PASSENGERS: "Too many passengers for that vehicle",
        SCHEDULE_CLOSED: "This scheduled request has ended",
        SCHEDULE_NOT_OPEN: "It's too early to confirm",
      },
    },
    notFound: {
      title: "This screen doesn't exist.",
      home: "Go to home screen",
    },
    webOnly: {
      title: "Operations console",
      body: "The operations console is available in a web browser only.",
    },
  },
  {
    tabs: {
      home: "Kreu",
      rides: "Udhëtimet",
      chat: "Mesazhet",
      profile: "Profili",
    },
    home: {
      welcome: "Mirë se erdhe {name}",
      welcomeNoName: "Mirë se erdhe",
      signOut: "Dil",
      notifications: "Njoftimet",
      unread_one: "{count} njoftim i palexuar",
      unread_other: "{count} njoftime të palexuara",
      rideInProgress: "Udhëtim në vazhdim",
      tapToOpen: "Prek për ta hapur",
      locationDenied:
        "Leja e vendndodhjes është e fikur. Mund të rezervosh duke shkruar adresën e nisjes në ekranin tjetër.",
      locationUnavailable:
        "Nuk e morëm dot vendndodhjen tënde. Provo sërish ose shkruaj adresën e nisjes në ekranin tjetër.",
      settings: "Cilësimet",
      currentLocation: "Vendndodhja jote aktuale",
      drive: "Bëhu shofer",
      recent: "Udhëtimet e fundit",
      seeAll: "Shiko të gjitha udhëtimet",
      loadingRides: "Po ngarkohen udhëtimet…",
      noRecent: "Ende pa udhëtime.",
    },
    history: {
      title: "Udhëtimet e tua",
      empty: "Ende pa udhëtime. Udhëtimet e kërkuara do të shfaqen këtu.",
      refreshFailed:
        "Udhëtimet nuk u rifreskuan dot. Tërhiq poshtë për të provuar sërish.",
      rideTo: "Udhëtim drejt {destination}",
      status: "Gjendja",
      requested: "Kërkuar",
      driver: "Shoferi",
      simulated: "{name} (i simuluar)",
      charged: "Tarifuar",
      fare: "Çmimi",
    },
    search: {
      placeholder: "Ku dëshiron të shkosh?",
      pickupPlaceholder: "Shkruaj adresën e nisjes",
      noKey:
        "Kërkimi i adresave nuk është konfiguruar në këtë version. Vendet e ruajtura funksionojnë.",
      noCoordinates:
        "Nuk i gjetëm koordinatat për këtë vend. Provo një rezultat tjetër.",
      failed: "Kërkimi i adresës dështoi. Kontrollo lidhjen dhe provo përsëri.",
      notFound: "Nuk u gjet asnjë vend.",
      timeout: "Kërkimi i adresës zgjati shumë. Provo përsëri.",
    },
    find: {
      title: "Udhëtim",
      from: "Nga",
      to: "Për",
      findNow: "Merr çmimin",
      stopProblem:
        "Njëra nga ndalesat është i njëjti vend me ndalesën ose vendndodhjen pranë saj.",
      problem: {
        PICKUP_MISSING: "Zgjidh një pikë nisjeje.",
        DESTINATION_MISSING: "Zgjidh një destinacion.",
        UNRESOLVED:
          "Njëra nga këto vendndodhje nuk u gjet dot. Zgjidhe përsëri.",
        TOO_CLOSE: "Nisja dhe destinacioni janë shumë afër.",
      },
    },
    stops: {
      title: "Ndalesa gjatë rrugës",
      hint: "Opsionale. Shto deri në {max} ndalesa mes nisjes dhe destinacionit. Shoferi i viziton në këtë radhë.",
      number: "Ndalesa {number}",
      moveUp: "Zhvendose ndalesën {number} më herët",
      moveDown: "Zhvendose ndalesën {number} më vonë",
      remove: "Hiq ndalesën {number}",
      search: "Kërko një ndalesë",
      add: "Shto një ndalesë",
      fixed:
        "Ndalesat nuk mund të shtohen, hiqen ose rirenditen pasi ta kërkosh udhëtimin.",
    },
    vehicle: {
      title: "Automjeti",
      passengers: "Pasagjerë",
      fewer: "Më pak pasagjerë",
      more: "Më shumë pasagjerë",
      choosePickup:
        "Zgjidh një pikë nisjeje për të parë kategoritë e automjeteve që ofrohen aty.",
      none: "Asnjë kategori automjeti nuk ofrohet në këtë pikë nisjeje tani.",
      noneForCount:
        "Asnjë kategori që ofrohet këtu nuk ka vende për kaq pasagjerë.",
      upTo: "Deri në {count} pasagjerë",
      nearby_one: "{count} shofer i përshtatshëm në linjë pranë",
      nearby_other: "{count} shoferë të përshtatshëm në linjë pranë",
      noneNearby: "Asnjë shofer i përshtatshëm në linjë pranë tani",
      estimate:
        "Numrat janë vlerësim i çastit i shoferëve të miratuar në linjë pranë nisjes, jo premtim se njëri do të pranojë.",
      development: "Shembull zhvillimi",
    },
    confirm: {
      itinerary: "Udhëtimi",
      pickup: "Nisja",
      destination: "Destinacioni",
      category: "Automjeti",
      passengers: "Pasagjerë",
      oneFare:
        "Një çmim mbulon gjithë udhëtimin, përfshirë ndalesat. Nuk ka tarifa pritjeje dhe ndalesat nuk mund të ndryshohen pasi ta kërkosh.",
      scheduledIntro:
        "Ky është çmimi aktual për kërkesën tënde të planifikuar. Shoferi kërkohet vetëm pasi të konfirmosh më poshtë.",
      backToScheduled: "Kthehu te kërkesa e planifikuar",
      title: "Konfirmo udhëtimin",
      loading: "Po marrim çmimin për udhëtimin…",
      missing: "Mungon nisja ose destinacioni. Kthehu dhe zgjidhi të dyja.",
      changeLocations: "Ndrysho nisjen ose destinacionin",
      price: "Çmimi",
      distance: "Gjatësia e rrugës",
      tripTime: "Koha e përafërt",
      driversNearby: "Shoferë në linjë pranë",
      willOffer: "Do t'ia ofrojmë udhëtimin shoferit më të afërt të lirë.",
      noDrivers:
        "Nuk ka shoferë në linjë pranë teje tani. Mund ta kërkosh gjithsesi: do të kërkojmë për pak kohë dhe do ta lirojmë bllokimin nëse askush nuk pranon.",
      noDriversVehicle:
        "Nuk ka shoferë në linjë pranë teje tani. Mund ta kërkosh gjithsesi: do të kërkojmë për pak kohë dhe nuk ka asgjë për të paguar nëse askush nuk pranon.",
      priceNoteVehicle:
        "Ky është çmimi që do të paguash. I paguan shoferit me kartë në pajisjen e tij ose me para në dorë në fund të udhëtimit. Në aplikacion nuk tarifohet asgjë.",
      priceNote:
        "Ky është çmimi që do të paguash. Karta autorizohet pikërisht për këtë shumë kur e kërkon dhe tarifohet vetëm kur udhëtimi përfundon.",
      heldFor_one: "Ky çmim mbahet edhe rreth {count} minutë.",
      heldFor_other: "Ky çmim mbahet edhe rreth {count} minuta.",
      heldSeconds: "Ky çmim mbahet edhe më pak se një minutë.",
      expired:
        "Ky çmim skadoi para se ta kërkoje udhëtimin. Nuk u tarifua asgjë. Merr një çmim të ri për të vazhduar.",
      getNewPrice: "Merr një çmim të ri",
      refresh: "Rifresko çmimin",
      priceChanged:
        "Çmimi ishte {previous} dhe tani është {current}. Shqyrtoje para se ta kërkosh.",
      priceSame: "Çmimi u rifreskua dhe nuk ka ndryshuar.",
      problemTitle: {
        fallback: "Nuk e morëm dot çmimin",
        PICKUP_OUTSIDE_SERVICE_AREA: "Nisja është jashtë zonës së shërbimit",
        DESTINATION_OUTSIDE_SERVICE_AREA:
          "Destinacioni është jashtë zonës së shërbimit",
        NO_ROUTE: "Nuk ka rrugë për makinë",
        TRIP_TOO_SHORT: "Udhëtimi është shumë i shkurtër",
        TRIP_TOO_LONG: "Udhëtimi është shumë i gjatë",
        ROUTING_UNAVAILABLE: "Rruga nuk u llogarit dot",
        ROUTING_BUSY: "Çmimet janë të ngarkuara",
        RATE_LIMITED: "Shumë kërkesa për çmim",
        ROUTING_NOT_CONFIGURED: "Çmimet nuk ofrohen",
        PRICING_NOT_CONFIGURED: "Çmimet ende nuk ofrohen këtu",
        NETWORK: "Nuk ke lidhje",
        STOP_OUTSIDE_SERVICE_AREA:
          "Një ndalesë është jashtë zonës së shërbimit",
        STOPS_TOO_CLOSE: "Ndalesat janë shumë afër njëra-tjetrës",
        CATEGORY_UNAVAILABLE: "Kjo kategori automjeti nuk ofrohet",
        TOO_MANY_PASSENGERS: "Shumë pasagjerë për këtë automjet",
        SCHEDULE_CLOSED: "Kjo kërkesë e planifikuar ka përfunduar",
        SCHEDULE_NOT_OPEN: "Është herët për të konfirmuar",
      },
    },
    notFound: {
      title: "Ky ekran nuk ekziston.",
      home: "Shko te kreu",
    },
    webOnly: {
      title: "Paneli i operimeve",
      body: "Paneli i operimeve ofrohet vetëm në shfletues.",
    },
  },
);
