import { section } from "../core";

export default section(
  {
    title: "Scheduled rides",
    newTitle: "Schedule a ride request",
    link: "Scheduled rides",
    scheduleLater: "Schedule for later",
    notReservation:
      "Scheduling saves your request. It does not reserve a driver or guarantee a pickup.",
    howItWorks:
      "About {lead} minutes before the pickup time we'll ask you to review the current price and confirm payment. A driver is requested only after you confirm. If you don't confirm by {grace} minutes after the pickup time, the request expires and nothing is charged.",
    noPriceYet:
      "No price is shown now because fares are calculated when you confirm, not days ahead.",
    pushHint:
      "Turn on notifications to get the reminder. Without them, open this screen around the pickup time to confirm.",
    date: "Date",
    time: "Time",
    dateHint: "YYYY-MM-DD",
    timeHint: "24-hour time, HH:MM",
    timezone: "Times are in the pickup area's time zone: {timezone}.",
    window: "You can schedule between {earliest} and {latest}.",
    quick: {
      inOneHour: "In 1 hour",
      inTwoHours: "In 2 hours",
      tomorrowMorning: "Tomorrow 08:00",
    },
    invalid: "Enter the date as YYYY-MM-DD and the time as HH:MM.",
    submit: "Schedule request",
    scheduling: "Scheduling…",
    ambiguousTitle: "That time happens twice",
    ambiguousBody:
      "The clocks go back on that day, so this time occurs twice. Which one do you mean?",
    earlier: "The earlier one",
    later: "The later one",
    empty: "You have no scheduled requests.",
    upcoming: "Upcoming",
    past: "Earlier",
    pickupAt: "Pickup time",
    confirmFrom: "Confirmation opens",
    confirmBy: "Confirm by",
    from: "From",
    to: "To",
    vehicle: "Vehicle",
    passengers_one: "{count} passenger",
    passengers_other: "{count} passengers",
    state: {
      scheduled: "Scheduled",
      awaiting_confirmation: "Waiting for your confirmation",
      searching: "Looking for a driver",
      fulfilled: "Ride requested",
      no_driver: "No driver found",
      cancelled: "Cancelled",
      expired: "Expired",
    },
    stateHint: {
      scheduled:
        "We'll remind you before the pickup time. No driver is reserved yet.",
      awaiting_confirmation:
        "Review the current price and confirm payment to request a driver.",
      searching: "Your request was confirmed and we're looking for a driver.",
      fulfilled: "This request became a ride. Open it for details.",
      no_driver:
        "No driver accepted in time. The hold on your card is released; see the receipt.",
      cancelled: "This request was cancelled. Nothing was charged for it.",
      expired: "This request ended without a ride. Nothing was charged.",
    },
    endReason: {
      cancelled_by_passenger: "You cancelled this request.",
      not_confirmed: "It wasn't confirmed in time.",
      missed_window:
        "The confirmation window passed before it could be opened.",
      area_unavailable: "Rides are no longer available at this pickup.",
      category_unavailable:
        "The chosen vehicle category is no longer available.",
      account_closed: "The account was closed.",
    },
    confirmNow: "Review price and confirm",
    openRide: "Open ride",
    openReceipt: "Open receipt",
    cancel: "Cancel scheduled request",
    cancelConfirm:
      "Cancel this scheduled request? No driver has been requested and nothing is charged.",
    cancelYes: "Yes, cancel it",
    cancelNo: "Keep it",
    notFound: "This scheduled request isn't available.",
    pendingTitle: "A scheduled ride is waiting for you",
    pendingBody:
      "Pickup {time} ({timezone}). Review the price and confirm before {deadline}.",
  },
  {
    title: "Udhëtime të planifikuara",
    newTitle: "Planifiko një kërkesë udhëtimi",
    link: "Udhëtime të planifikuara",
    scheduleLater: "Planifiko për më vonë",
    notReservation:
      "Planifikimi ruan kërkesën tënde. Nuk rezervon shofer dhe nuk garanton marrjen.",
    howItWorks:
      "Rreth {lead} minuta para orës së marrjes do të të kërkojmë të shohësh çmimin aktual dhe të konfirmosh pagesën. Shoferi kërkohet vetëm pasi të konfirmosh. Nëse nuk konfirmon deri {grace} minuta pas orës së marrjes, kërkesa skadon dhe nuk tarifohet asgjë.",
    noPriceYet:
      "Çmimi nuk shfaqet tani sepse llogaritet kur konfirmon, jo ditë përpara.",
    pushHint:
      "Aktivizo njoftimet për të marrë kujtesën. Pa to, hape këtë ekran rreth orës së marrjes për të konfirmuar.",
    date: "Data",
    time: "Ora",
    dateHint: "VVVV-MM-DD",
    timeHint: "Ora në formatin 24-orësh, HH:MM",
    timezone: "Orët janë në zonën kohore të pikës së nisjes: {timezone}.",
    window: "Mund të planifikosh nga {earliest} deri më {latest}.",
    quick: {
      inOneHour: "Pas 1 ore",
      inTwoHours: "Pas 2 orësh",
      tomorrowMorning: "Nesër në 08:00",
    },
    invalid: "Shkruaj datën si VVVV-MM-DD dhe orën si HH:MM.",
    submit: "Planifiko kërkesën",
    scheduling: "Duke planifikuar…",
    ambiguousTitle: "Kjo orë ndodh dy herë",
    ambiguousBody:
      "Atë ditë ora kthehet mbrapsht, ndaj kjo orë ndodh dy herë. Cilën ke parasysh?",
    earlier: "Të parën",
    later: "Të dytën",
    empty: "Nuk ke kërkesa të planifikuara.",
    upcoming: "Në vijim",
    past: "Më parë",
    pickupAt: "Ora e marrjes",
    confirmFrom: "Konfirmimi hapet",
    confirmBy: "Konfirmo deri më",
    from: "Nga",
    to: "Për",
    vehicle: "Automjeti",
    passengers_one: "{count} pasagjer",
    passengers_other: "{count} pasagjerë",
    state: {
      scheduled: "E planifikuar",
      awaiting_confirmation: "Në pritje të konfirmimit tënd",
      searching: "Po kërkohet shofer",
      fulfilled: "Udhëtimi u kërkua",
      no_driver: "Nuk u gjet shofer",
      cancelled: "Anuluar",
      expired: "Skaduar",
    },
    stateHint: {
      scheduled:
        "Do të të kujtojmë para orës së marrjes. Ende nuk është rezervuar asnjë shofer.",
      awaiting_confirmation:
        "Shiko çmimin aktual dhe konfirmo pagesën për të kërkuar një shofer.",
      searching: "Kërkesa u konfirmua dhe po kërkojmë një shofer.",
      fulfilled: "Kjo kërkesë u bë udhëtim. Hape për detaje.",
      no_driver:
        "Asnjë shofer nuk pranoi në kohë. Bllokimi në kartë lirohet; shiko faturën.",
      cancelled: "Kjo kërkesë u anulua. Nuk u tarifua asgjë për të.",
      expired: "Kjo kërkesë përfundoi pa udhëtim. Nuk u tarifua asgjë.",
    },
    endReason: {
      cancelled_by_passenger: "E anulove këtë kërkesë.",
      not_confirmed: "Nuk u konfirmua në kohë.",
      missed_window: "Afati i konfirmimit kaloi para se të hapej.",
      area_unavailable: "Udhëtimet nuk ofrohen më nga kjo pikë nisjeje.",
      category_unavailable: "Kategoria e zgjedhur e automjetit nuk ofrohet më.",
      account_closed: "Llogaria u mbyll.",
    },
    confirmNow: "Shiko çmimin dhe konfirmo",
    openRide: "Hap udhëtimin",
    openReceipt: "Hap faturën",
    cancel: "Anulo kërkesën e planifikuar",
    cancelConfirm:
      "Ta anulosh këtë kërkesë të planifikuar? Nuk është kërkuar asnjë shofer dhe nuk tarifohet asgjë.",
    cancelYes: "Po, anuloje",
    cancelNo: "Mbaje",
    notFound: "Kjo kërkesë e planifikuar nuk është e disponueshme.",
    pendingTitle: "Një udhëtim i planifikuar pret konfirmimin tënd",
    pendingBody:
      "Marrja në {time} ({timezone}). Shiko çmimin dhe konfirmo para orës {deadline}.",
  },
);
