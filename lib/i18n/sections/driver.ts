import { section } from "../core";

export default section(
  {
    title: "Drive",
    riderMode: "Rider mode",
    categories: "Vehicle categories you're approved for: {names}",
    categoriesInactive: "{name} (not offered right now)",
    noCategories:
      "Your vehicle isn't linked to an active category, so you won't receive requests. Contact support.",
    categoriesNote:
      "Categories are set when your vehicle is verified. Contact support to ask for a change.",
    loading: "Loading your driver account…",
    reconnecting: "Reconnecting… showing the last known information.",
    status: {
      draft_title: "Draft",
      draft_body:
        "Finish your details and upload each document, then submit for review.",
      submitted_title: "Submitted for review",
      submitted_body:
        "An operator will review your details and documents. You can't edit them while they're being reviewed.",
      changes_requested_title: "Changes requested",
      changes_requested_body:
        "An operator asked for changes. Update what's listed below and submit again.",
      approved_title: "Approved",
      approved_body: "You can go online and receive ride requests.",
      rejected_title: "Not approved",
      rejected_body:
        "Your application wasn't approved. You can start a new application.",
      suspended_title: "Suspended",
      suspended_body:
        "You can't go online. Contact support if you think this is a mistake.",
      expired_title: "Approval expired",
      expired_body:
        "One of your documents has expired. Start an update and upload a current document.",
    },
    whyOffline: "Why you can't go online",
    reviewMessage: "Message from the review team",
    requirementVehicle: "Vehicle make, model, color and plate",
    editDetails: "Edit details",
    submit: "Submit for review",
    completeAll: "Complete every item above to submit.",
    startUpdate: "Start an update",
    updateNote:
      "Starting an update takes you off the road until an operator approves it again.",
    accountId: "Your account ID:",
    updateVehicle: "Update vehicle or documents",
    online: "You're online",
    offline: "You're offline",
    onlineBody:
      "You'll receive ride requests near you. Your location is shared while you're online.",
    offlineBody: "Go online to start receiving ride requests near you.",
    yourRating: "Your rating: {rating}",
    viewEarnings: "View earnings",
    goOnline: "Go online",
    goOffline: "Go offline",
    finishOnly:
      "You can finish your current trip. You won't receive new requests.",
    locationTitle: "Share your location to drive",
    locationBody:
      "While you are online or on a ride, we use your location to offer you nearby requests and to show your approximate position and arrival time to your passenger. Sharing stops when you go offline.",
    allowLocation: "Allow location",
    notNow: "Not now",
    locationServicesOff: "Turn on location services to go online.",
    locationDenied:
      "Location permission is off. Enable it in Settings to go online.",
    locationNeeded:
      "Location permission is needed to go online. You can enable it in Settings.",
    noFix: "Couldn't get your position. Check that GPS is on and try again.",
    pushDevBuild:
      "Ride request notifications need a development build on Android. Keep this screen open.",
    pushDenied:
      "Notifications are off, so you'll only see requests while this screen is open.",
    pushUnavailable:
      "Notifications aren't set up on this device. Keep this screen open.",
    currentRide: "Current ride",
    openRide: "Open ride",
    waiting: "Waiting for ride requests…",
    form: {
      introNew:
        "Apply to drive. Save your details, upload your documents, then submit. An operator reviews every application before you can go online.",
      introEdit:
        "Update your details. Changes are saved as a draft until you submit.",
      displayName: "Name shown to passengers",
      make: "Vehicle make",
      model: "Vehicle model",
      color: "Vehicle colour",
      year: "Model year (optional)",
      plate: "Plate",
      seats: "Passenger seats",
      invalid:
        "Please fill in every required field. Colour uses letters only; plates use letters, numbers, spaces, or dashes; seats 1–8; year is optional.",
      save: "Save details",
      saveFailed: "Couldn't save your details.",
    },
    documents: {
      title: "Documents",
      intro:
        "JPEG, PNG, or PDF up to 10 MB. Files are stored privately and are only seen by the operators who review your application. A person checks them; nothing is verified automatically.",
      kind: {
        identity: "Proof of identity",
        driving_license: "Driving licence",
        vehicle_registration: "Vehicle registration",
        insurance: "Vehicle insurance",
      },
      status: {
        pending_upload: "Upload not finished",
        uploaded: "Waiting for review",
        accepted: "Accepted",
        rejected: "Rejected",
        replaced: "Replaced",
        invalid: "Invalid file",
        deleted: "Deleted",
      },
      notUploaded: "Not uploaded",
      expires: "Expires {date}",
      expiry: "Expiry date (YYYY-MM-DD)",
      expiryRequired:
        "Enter the expiry date shown on the document (YYYY-MM-DD).",
      replace: "Replace file",
      choose: "Choose file",
      preparing: "Preparing…",
      uploading: "Uploading…",
      checking: "Checking…",
      badType: "Use a JPEG, PNG, or PDF file.",
      empty: "That file looks empty.",
      tooLarge: "Files must be 10 MB or smaller.",
      storageRefused:
        "The storage service refused this file. Check that it is the size and type you chose, then try again.",
      uploadFailed: "Upload failed. Try again.",
    },
    trips: {
      title: "Recent trips",
      empty: "Completed trips will appear here.",
      quotedFare: "quoted fare {amount}",
      ratePassenger: "Rate passenger",
    },
    earnings: {
      title: "Earnings",
      loading: "Loading earnings…",
      period: {
        today: "Today",
        week: "Last 7 days",
        month: "Last 30 days",
        all: "All time",
      },
      confirmed: "Recorded earnings · {period}",
      completedRides: "Completed rides",
      faresCaptured: "Fares captured",
      commissionNow: "Platform commission ({rate} now)",
      fareShare: "Your fare share",
      tips: "Tips",
      refundAdjustments: "Refund adjustments",
      disputes: "Payment disputes",
      net: "Net recorded",
      disputesOpen_one: "{count} payment dispute open",
      disputesOpen_other: "{count} payment disputes open",
      disputesBody:
        "A passenger's bank is disputing a charge. Funds the card network withdraws are shown as separate lines and are added back if the dispute is won.",
      pendingTitle: "Awaiting payment confirmation",
      pendingRides_one: "{count} ride · {amount} in fares",
      pendingRides_other: "{count} rides · {amount} in fares",
      pendingTips_one: "{count} tip · {amount} processing",
      pendingTips_other: "{count} tips · {amount} processing",
      pendingNote:
        "These aren't included above until the card processor confirms the payment.",
      noPayoutsTitle: "No payouts yet",
      noPayoutsBody:
        "Payouts aren't set up yet. These amounts are earnings recorded for you; none of it has been paid out.",
      policy: "Commission policy {version}",
      ridesTitle: "Completed rides",
      noRides: "No completed rides in this period.",
      rideState: {
        confirmed: "Confirmed",
        pending: "Awaiting payment confirmation",
        not_charged: "Not charged",
      },
      tipPaid: "tip recorded",
      tipProcessing: "tip processing",
      disputed: "payment disputed",
      fareCaptured: "Fare captured",
      quotedFare: "Quoted fare",
      commission: "Platform commission ({rate}, policy {version})",
      yourShare: "Your share",
      pendingRide:
        "Not counted yet: the passenger's payment hasn't been confirmed by the card processor.",
      notCharged: "This fare was not charged, so nothing was recorded.",
      tipLinePaid: "Tip (confirmed)",
      tipLineProcessing: "Tip (processing, not counted yet)",
      netRide: "Net for this ride",
      entry: {
        ride_earning: "Fare earned",
        tip: "Tip",
        fare_refund_adjustment: "Refund adjustment (fare)",
        tip_refund_adjustment: "Refund adjustment (tip)",
        dispute_withdrawal: "Payment disputed: funds withdrawn",
        dispute_reinstatement: "Dispute resolved: funds reinstated",
      },
    },
  },
  {
    title: "Shofer",
    riderMode: "Si pasagjer",
    categories: "Kategoritë e automjetit për të cilat je miratuar: {names}",
    categoriesInactive: "{name} (nuk ofrohet tani)",
    noCategories:
      "Automjeti yt nuk është i lidhur me një kategori aktive, ndaj nuk do të marrësh kërkesa. Kontakto ndihmën.",
    categoriesNote:
      "Kategoritë caktohen kur verifikohet automjeti. Kontakto ndihmën për të kërkuar një ndryshim.",
    loading: "Po ngarkohet llogaria e shoferit…",
    reconnecting: "Duke u rilidhur… po shfaqen të dhënat e fundit të njohura.",
    status: {
      draft_title: "Draft",
      draft_body:
        "Plotëso të dhënat dhe ngarko çdo dokument, pastaj dërgoje për shqyrtim.",
      submitted_title: "Dërguar për shqyrtim",
      submitted_body:
        "Një operator do t'i shqyrtojë të dhënat dhe dokumentet. Nuk mund t'i ndryshosh gjatë shqyrtimit.",
      changes_requested_title: "Kërkohen ndryshime",
      changes_requested_body:
        "Një operator kërkoi ndryshime. Përditëso çfarë është renditur më poshtë dhe dërgoje sërish.",
      approved_title: "Miratuar",
      approved_body: "Mund të dalësh në linjë dhe të marrësh kërkesa.",
      rejected_title: "Nuk u miratua",
      rejected_body:
        "Aplikimi yt nuk u miratua. Mund të fillosh një aplikim të ri.",
      suspended_title: "Pezulluar",
      suspended_body:
        "Nuk mund të dalësh në linjë. Kontakto ndihmën nëse mendon se është gabim.",
      expired_title: "Miratimi ka skaduar",
      expired_body:
        "Një nga dokumentet ka skaduar. Fillo një përditësim dhe ngarko një dokument të vlefshëm.",
    },
    whyOffline: "Pse nuk mund të dalësh në linjë",
    reviewMessage: "Mesazh nga ekipi i shqyrtimit",
    requirementVehicle: "Marka, modeli, ngjyra dhe targa e automjetit",
    editDetails: "Ndrysho të dhënat",
    submit: "Dërgo për shqyrtim",
    completeAll: "Plotëso çdo pikë më sipër për ta dërguar.",
    startUpdate: "Fillo një përditësim",
    updateNote:
      "Fillimi i një përditësimi të heq nga rruga derisa një operator ta miratojë sërish.",
    accountId: "ID e llogarisë sate:",
    updateVehicle: "Përditëso automjetin ose dokumentet",
    online: "Je në linjë",
    offline: "Je jashtë linje",
    onlineBody:
      "Do të marrësh kërkesa udhëtimi pranë teje. Vendndodhja jote ndahet ndërsa je në linjë.",
    offlineBody: "Dil në linjë për të marrë kërkesa udhëtimi pranë teje.",
    yourRating: "Vlerësimi yt: {rating}",
    viewEarnings: "Shiko të ardhurat",
    goOnline: "Dil në linjë",
    goOffline: "Dil jashtë linje",
    finishOnly:
      "Mund ta përfundosh udhëtimin aktual. Nuk do të marrësh kërkesa të reja.",
    locationTitle: "Ndaj vendndodhjen për të punuar",
    locationBody:
      "Ndërsa je në linjë ose në udhëtim, e përdorim vendndodhjen tënde për të të ofruar kërkesa pranë dhe për t'i treguar pasagjerit pozicionin e përafërt dhe kohën e mbërritjes. Ndarja ndalon kur del jashtë linje.",
    allowLocation: "Lejo vendndodhjen",
    notNow: "Jo tani",
    locationServicesOff:
      "Aktivizo shërbimet e vendndodhjes për të dalë në linjë.",
    locationDenied:
      "Leja e vendndodhjes është e fikur. Aktivizoje te Cilësimet për të dalë në linjë.",
    locationNeeded:
      "Leja e vendndodhjes nevojitet për të dalë në linjë. Mund ta aktivizosh te Cilësimet.",
    noFix:
      "Nuk e morëm dot pozicionin. Kontrollo që GPS është aktiv dhe provo përsëri.",
    pushDevBuild:
      "Njoftimet për kërkesat kërkojnë një version zhvillimi në Android. Mbaje këtë ekran hapur.",
    pushDenied:
      "Njoftimet janë të fikura, ndaj kërkesat i sheh vetëm kur ky ekran është i hapur.",
    pushUnavailable:
      "Njoftimet nuk janë konfiguruar në këtë pajisje. Mbaje këtë ekran hapur.",
    currentRide: "Udhëtimi aktual",
    openRide: "Hap udhëtimin",
    waiting: "Në pritje të kërkesave…",
    form: {
      introNew:
        "Apliko për të punuar si shofer. Ruaj të dhënat, ngarko dokumentet, pastaj dërgoje. Një operator shqyrton çdo aplikim para se të dalësh në linjë.",
      introEdit:
        "Përditëso të dhënat. Ndryshimet ruhen si draft derisa t'i dërgosh.",
      displayName: "Emri që shohin pasagjerët",
      make: "Marka e automjetit",
      model: "Modeli i automjetit",
      color: "Ngjyra e automjetit",
      year: "Viti i prodhimit (opsional)",
      plate: "Targa",
      seats: "Vende për pasagjerë",
      invalid:
        "Plotëso çdo fushë të detyrueshme. Ngjyra përdor vetëm shkronja; targa përdor shkronja, numra, hapësira ose viza; vende 1–8; viti është opsional.",
      save: "Ruaj të dhënat",
      saveFailed: "Të dhënat nuk u ruajtën dot.",
    },
    documents: {
      title: "Dokumentet",
      intro:
        "JPEG, PNG ose PDF deri në 10 MB. Skedarët ruhen privatisht dhe shihen vetëm nga operatorët që shqyrtojnë aplikimin. I kontrollon një person; asgjë nuk verifikohet automatikisht.",
      kind: {
        identity: "Dokument identiteti",
        driving_license: "Leje drejtimi",
        vehicle_registration: "Leje qarkullimi",
        insurance: "Sigurimi i automjetit",
      },
      status: {
        pending_upload: "Ngarkimi nuk ka përfunduar",
        uploaded: "Në pritje të shqyrtimit",
        accepted: "Pranuar",
        rejected: "Refuzuar",
        replaced: "Zëvendësuar",
        invalid: "Skedar i pavlefshëm",
        deleted: "Fshirë",
      },
      notUploaded: "Nuk është ngarkuar",
      expires: "Skadon më {date}",
      expiry: "Data e skadimit (VVVV-MM-DD)",
      expiryRequired:
        "Shkruaj datën e skadimit që shfaqet në dokument (VVVV-MM-DD).",
      replace: "Zëvendëso skedarin",
      choose: "Zgjidh skedarin",
      preparing: "Duke përgatitur…",
      uploading: "Duke ngarkuar…",
      checking: "Duke kontrolluar…",
      badType: "Përdor një skedar JPEG, PNG ose PDF.",
      empty: "Ky skedar duket bosh.",
      tooLarge: "Skedarët duhet të jenë 10 MB ose më të vegjël.",
      storageRefused:
        "Shërbimi i ruajtjes e refuzoi këtë skedar. Kontrollo që ka madhësinë dhe llojin që zgjodhe, pastaj provo përsëri.",
      uploadFailed: "Ngarkimi dështoi. Provo përsëri.",
    },
    trips: {
      title: "Udhëtimet e fundit",
      empty: "Udhëtimet e përfunduara do të shfaqen këtu.",
      quotedFare: "çmimi i ofruar {amount}",
      ratePassenger: "Vlerëso pasagjerin",
    },
    earnings: {
      title: "Të ardhurat",
      loading: "Po ngarkohen të ardhurat…",
      period: {
        today: "Sot",
        week: "7 ditët e fundit",
        month: "30 ditët e fundit",
        all: "Gjithë koha",
      },
      confirmed: "Të ardhura të regjistruara · {period}",
      completedRides: "Udhëtime të përfunduara",
      faresCaptured: "Çmime të arkëtuara",
      commissionNow: "Komisioni i platformës ({rate} tani)",
      fareShare: "Pjesa jote nga çmimi",
      tips: "Bakshishe",
      refundAdjustments: "Rregullime nga rimbursimet",
      disputes: "Mosmarrëveshje pagesash",
      net: "Neto e regjistruar",
      disputesOpen_one: "{count} mosmarrëveshje pagese e hapur",
      disputesOpen_other: "{count} mosmarrëveshje pagesash të hapura",
      disputesBody:
        "Banka e një pasagjeri po kundërshton një tarifim. Fondet që tërheq rrjeti i kartave shfaqen si rreshta të veçantë dhe shtohen sërish nëse mosmarrëveshja fitohet.",
      pendingTitle: "Në pritje të konfirmimit të pagesës",
      pendingRides_one: "{count} udhëtim · {amount} në çmime",
      pendingRides_other: "{count} udhëtime · {amount} në çmime",
      pendingTips_one: "{count} bakshish · {amount} në përpunim",
      pendingTips_other: "{count} bakshishe · {amount} në përpunim",
      pendingNote:
        "Këto nuk përfshihen më sipër derisa përpunuesi i kartave ta konfirmojë pagesën.",
      noPayoutsTitle: "Ende pa pagesa për shoferët",
      noPayoutsBody:
        "Pagesat për shoferët ende nuk janë konfiguruar. Këto shuma janë të ardhura të regjistruara për ty; asnjë pjesë nuk është paguar.",
      policy: "Politika e komisionit {version}",
      ridesTitle: "Udhëtime të përfunduara",
      noRides: "Nuk ka udhëtime të përfunduara në këtë periudhë.",
      rideState: {
        confirmed: "Konfirmuar",
        pending: "Në pritje të konfirmimit të pagesës",
        not_charged: "Pa tarifim",
      },
      tipPaid: "bakshish i regjistruar",
      tipProcessing: "bakshish në përpunim",
      disputed: "pagesa e kundërshtuar",
      fareCaptured: "Çmimi i arkëtuar",
      quotedFare: "Çmimi i ofruar",
      commission: "Komisioni i platformës ({rate}, politika {version})",
      yourShare: "Pjesa jote",
      pendingRide:
        "Ende nuk llogaritet: pagesa e pasagjerit nuk është konfirmuar nga përpunuesi i kartave.",
      notCharged: "Ky çmim nuk u tarifua, ndaj nuk u regjistrua asgjë.",
      tipLinePaid: "Bakshish (i konfirmuar)",
      tipLineProcessing: "Bakshish (në përpunim, ende nuk llogaritet)",
      netRide: "Neto për këtë udhëtim",
      entry: {
        ride_earning: "Çmim i fituar",
        tip: "Bakshish",
        fare_refund_adjustment: "Rregullim nga rimbursimi (çmimi)",
        tip_refund_adjustment: "Rregullim nga rimbursimi (bakshishi)",
        dispute_withdrawal: "Pagesa u kundërshtua: fondet u tërhoqën",
        dispute_reinstatement: "Mosmarrëveshja u zgjidh: fondet u rikthyen",
      },
    },
  },
);
