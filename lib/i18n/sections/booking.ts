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
      problem: {
        PICKUP_MISSING: "Choose a pickup location.",
        DESTINATION_MISSING: "Choose a destination.",
        UNRESOLVED:
          "One of these locations couldn't be resolved. Please pick it again.",
        TOO_CLOSE: "Pickup and destination are too close together.",
      },
    },
    confirm: {
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
      problem: {
        PICKUP_MISSING: "Zgjidh një pikë nisjeje.",
        DESTINATION_MISSING: "Zgjidh një destinacion.",
        UNRESOLVED:
          "Njëra nga këto vendndodhje nuk u gjet dot. Zgjidhe përsëri.",
        TOO_CLOSE: "Nisja dhe destinacioni janë shumë afër.",
      },
    },
    confirm: {
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
