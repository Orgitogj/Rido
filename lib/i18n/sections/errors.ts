import { section } from "../core";

export default section(
  {
    generic: "Something went wrong. Please try again.",
    NETWORK: "Couldn't reach the server. Check your connection and try again.",
    TIMEOUT: "The server took too long to answer. Please try again.",
    UNAUTHENTICATED: "Your session has ended. Please sign in again.",
    FORBIDDEN: "You don't have access to this.",
    NOT_FOUND: "We couldn't find that.",
    INVALID_INPUT:
      "Some details are missing or not valid. Check them and try again.",
    RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
    SERVICE_UNAVAILABLE:
      "This service is temporarily unavailable. Please try again later.",
    INTERNAL_ERROR: "Something went wrong on our side. Please try again.",
    ACCOUNT_DELETED: "This account has been deleted.",
    ACCOUNT_DELETION_PENDING:
      "This account is being deleted and can't be used.",
    PICKUP_OUTSIDE_SERVICE_AREA:
      "Rides aren't available from this pickup location yet. Choose a pickup inside a covered area.",
    DESTINATION_OUTSIDE_SERVICE_AREA:
      "This destination is outside the area we serve from your pickup.",
    NO_ROUTE:
      "There's no drivable route between these places. Choose a different pickup or destination.",
    TRIP_TOO_SHORT: "Pickup and destination are too close together.",
    TRIP_TOO_LONG: "This trip is longer than the service allows.",
    ROUTING_UNAVAILABLE:
      "We couldn't calculate a route right now. Please try again.",
    ROUTING_BUSY:
      "We're getting a lot of price requests. Please try again in a minute.",
    ROUTING_NOT_CONFIGURED: "Pricing is unavailable right now.",
    PRICING_NOT_CONFIGURED:
      "Rides in this area aren't priced yet. Please try again later.",
    QUOTE_EXPIRED: "This price has expired. Get a new price to continue.",
    SERVICE_AREA_UNAVAILABLE: "Rides are no longer available in this area.",
    ACTIVE_RIDE_EXISTS: "You already have a ride in progress.",
    ALREADY_REQUESTED: "This ride has already been requested.",
    RIDE_ENDED: "This request has ended. Please get a new price.",
    PAYMENT_CANCELLED:
      "This request can no longer be paid. Please get a new price.",
    PAYMENT_MISMATCH: "This payment does not match the booking.",
    INVALID_TRANSITION: "That action isn't possible right now.",
    OFFER_EXPIRED: "This request expired before you responded.",
    OFFER_UNAVAILABLE: "This request is no longer available.",
    NOT_A_DRIVER: "This account is not a driver.",
    DRIVER_NOT_APPROVED: "Your driver account isn't approved yet.",
    DRIVER_APPROVAL_EXPIRED:
      "One of your documents has expired. Upload a renewed document to drive again.",
    GO_OFFLINE_FIRST:
      "Go offline and finish any ride before updating your details.",
    PROFILE_LOCKED: "Your application can't be edited right now.",
    REQUIREMENTS_MISSING:
      "Some required details or documents are still missing.",
    LOCATION_REQUIRED: "Your location is needed to go online.",
    LOCATION_REJECTED:
      "We couldn't use that location. Check GPS and try again.",
    STORAGE_NOT_CONFIGURED:
      "Document uploads aren't available on this server yet.",
    EXPIRY_REQUIRED: "Enter the expiry date shown on the document.",
    DOCUMENT_EXPIRED: "This document has already expired.",
    FILE_REJECTED:
      "That file isn't a readable JPEG, PNG or PDF of the expected size. Upload it again.",
    UPLOAD_NOT_FOUND: "We didn't receive the file. Try uploading it again.",
    UPLOAD_CHANGED:
      "The file changed while we were checking it. Upload it again.",
    UPLOAD_CLOSED: "This upload was replaced or expired. Start a new upload.",
    CHAT_CLOSED: "This conversation is closed.",
    CHAT_LIMIT_REACHED: "This conversation has reached its message limit.",
    RATING_NOT_ALLOWED: "This ride can't be rated.",
    RATING_LOCKED: "This rating can no longer be changed.",
    TIP_NOT_ALLOWED: "A tip can't be added to this ride.",
    TIP_ALREADY_PAID: "You've already tipped for this ride.",
    TIP_IN_PROGRESS: "A tip payment is already in progress.",
    TIP_CANCELED: "This tip was cancelled.",
    REPORT_WINDOW_CLOSED: "The time to report this ride has passed.",
    CANNOT_REPORT_OWN_MESSAGE: "You can't report your own message.",
    TOO_MANY_SHARES: "You've reached the limit of share links for this ride.",
    SHARE_UNAVAILABLE: "This trip can't be shared right now.",
    SHARE_NOT_AVAILABLE: "This link is no longer available.",
    PLACE_LIMIT:
      "You've reached the limit of saved places. Delete one to add another.",
    LABEL_NOT_EDITABLE: "Home and Work can't be renamed.",
    SUPPORT_CLOSED: "This support request is closed.",
    PIN_REQUIRED: "Enter the passenger's trip PIN to start.",
    PIN_INCORRECT:
      "That PIN doesn't match. Ask the passenger to read it again.",
    PIN_LOCKED: "Too many incorrect PINs. Wait a moment before trying again.",
    PIN_BLOCKED:
      "PIN entry is blocked for this pickup. Contact support or cancel the ride.",
    PIN_UNAVAILABLE:
      "The trip PIN can't be checked right now. Contact support.",
    ATTACHMENT_LIMIT: "You've reached the limit of photos for this request.",
    ATTACHMENT_NOT_READY:
      "One of the photos isn't available. Remove it and add it again.",
    ATTACHMENT_SENT: "A photo that was already sent can't be removed.",
    CATEGORY_REQUIRED: "Choose at least one vehicle category.",
    CATEGORY_UNAVAILABLE:
      "That vehicle category isn't available here right now. Choose another one.",
    TOO_MANY_PASSENGERS:
      "That vehicle category doesn't seat that many passengers.",
    STOPS_TOO_CLOSE:
      "Two places next to each other on this trip are the same or too close together.",
    STOP_OUTSIDE_SERVICE_AREA:
      "One of the stops is outside the area we serve from your pickup.",
    STOPS_REMAINING: "Mark each stop as reached before completing the trip.",
    STOP_OUT_OF_ORDER:
      "That stop was already updated. Showing the latest status.",
    SCHEDULE_TOO_SOON:
      "That time is too soon to schedule. Pick a later time, or request a ride now.",
    SCHEDULE_TOO_FAR: "That time is too far ahead to schedule.",
    SCHEDULE_TIME_SKIPPED:
      "That time doesn't exist on that day because the clocks go forward. Pick another time.",
    SCHEDULE_TIME_AMBIGUOUS:
      "That time happens twice on that day because the clocks go back. Choose the earlier or the later one.",
    SCHEDULE_LIMIT:
      "You've reached the limit of upcoming scheduled requests. Cancel one to add another.",
    SCHEDULE_OVERLAP:
      "You already have a scheduled request close to that time.",
    SCHEDULE_CLOSED:
      "This scheduled request has ended. Nothing was charged for it.",
    SCHEDULE_NOT_OPEN:
      "It's too early to confirm this scheduled request. We'll remind you when it opens.",
    DELETION_BLOCKED: "Your account can't be deleted yet.",
    REAUTH_REQUIRED: "Please confirm your identity again to continue.",
    VERSION_CONFLICT: "This changed since you opened it. Reload and try again.",
  },
  {
    generic: "Diçka shkoi keq. Të lutem provo përsëri.",
    NETWORK:
      "Nuk u arrit lidhja me serverin. Kontrollo internetin dhe provo përsëri.",
    TIMEOUT: "Serveri po vonon të përgjigjet. Të lutem provo përsëri.",
    UNAUTHENTICATED: "Sesioni yt ka përfunduar. Të lutem hyr përsëri.",
    FORBIDDEN: "Nuk ke qasje në këtë.",
    NOT_FOUND: "Nuk e gjetëm atë që kërkove.",
    INVALID_INPUT:
      "Disa të dhëna mungojnë ose nuk janë të sakta. Kontrolloji dhe provo përsëri.",
    RATE_LIMITED: "Shumë kërkesa. Prit pak dhe provo përsëri.",
    SERVICE_UNAVAILABLE:
      "Ky shërbim nuk është i disponueshëm për momentin. Provo më vonë.",
    INTERNAL_ERROR: "Diçka shkoi keq nga ana jonë. Të lutem provo përsëri.",
    ACCOUNT_DELETED: "Kjo llogari është fshirë.",
    ACCOUNT_DELETION_PENDING:
      "Kjo llogari po fshihet dhe nuk mund të përdoret.",
    PICKUP_OUTSIDE_SERVICE_AREA:
      "Udhëtimet nuk ofrohen ende nga kjo pikë nisjeje. Zgjidh një pikë nisjeje brenda zonës së mbuluar.",
    DESTINATION_OUTSIDE_SERVICE_AREA:
      "Ky destinacion është jashtë zonës që shërbejmë nga pika jote e nisjes.",
    NO_ROUTE:
      "Nuk ka rrugë të kalueshme me makinë mes këtyre vendeve. Zgjidh një pikë nisjeje ose destinacion tjetër.",
    TRIP_TOO_SHORT:
      "Pika e nisjes dhe destinacioni janë shumë afër njëra-tjetrës.",
    TRIP_TOO_LONG: "Ky udhëtim është më i gjatë nga sa lejon shërbimi.",
    ROUTING_UNAVAILABLE:
      "Nuk e llogaritëm dot rrugën tani. Të lutem provo përsëri.",
    ROUTING_BUSY:
      "Po marrim shumë kërkesa për çmim. Provo përsëri pas një minute.",
    ROUTING_NOT_CONFIGURED: "Çmimi nuk mund të llogaritet për momentin.",
    PRICING_NOT_CONFIGURED:
      "Udhëtimet në këtë zonë nuk kanë ende çmim. Provo më vonë.",
    QUOTE_EXPIRED: "Ky çmim ka skaduar. Merr një çmim të ri për të vazhduar.",
    SERVICE_AREA_UNAVAILABLE: "Udhëtimet nuk ofrohen më në këtë zonë.",
    ACTIVE_RIDE_EXISTS: "Ke tashmë një udhëtim në vazhdim.",
    ALREADY_REQUESTED: "Ky udhëtim është kërkuar tashmë.",
    RIDE_ENDED: "Kjo kërkesë ka përfunduar. Të lutem merr një çmim të ri.",
    PAYMENT_CANCELLED:
      "Kjo kërkesë nuk mund të paguhet më. Të lutem merr një çmim të ri.",
    PAYMENT_MISMATCH: "Kjo pagesë nuk përputhet me rezervimin.",
    INVALID_TRANSITION: "Ky veprim nuk është i mundur tani.",
    OFFER_EXPIRED: "Kjo kërkesë skadoi para se të përgjigjeshe.",
    OFFER_UNAVAILABLE: "Kjo kërkesë nuk është më e disponueshme.",
    NOT_A_DRIVER: "Kjo llogari nuk është llogari shoferi.",
    DRIVER_NOT_APPROVED: "Llogaria jote si shofer nuk është miratuar ende.",
    DRIVER_APPROVAL_EXPIRED:
      "Njërit prej dokumenteve të tua i ka skaduar afati. Ngarko dokumentin e rinovuar për të vazhduar punën.",
    GO_OFFLINE_FIRST:
      "Dil jashtë linje dhe përfundo çdo udhëtim para se të ndryshosh të dhënat.",
    PROFILE_LOCKED: "Aplikimi yt nuk mund të ndryshohet tani.",
    REQUIREMENTS_MISSING:
      "Mungojnë ende disa të dhëna ose dokumente të detyrueshme.",
    LOCATION_REQUIRED: "Nevojitet vendndodhja jote për të dalë në linjë.",
    LOCATION_REJECTED:
      "Nuk e përdorëm dot atë vendndodhje. Kontrollo GPS-in dhe provo përsëri.",
    STORAGE_NOT_CONFIGURED:
      "Ngarkimi i dokumenteve nuk ofrohet ende në këtë server.",
    EXPIRY_REQUIRED: "Shkruaj datën e skadimit që shfaqet në dokument.",
    DOCUMENT_EXPIRED: "Këtij dokumenti i ka skaduar afati.",
    FILE_REJECTED:
      "Ky skedar nuk është JPEG, PNG ose PDF i lexueshëm me madhësinë e pritur. Ngarkoje përsëri.",
    UPLOAD_NOT_FOUND: "Nuk e morëm skedarin. Provo ta ngarkosh përsëri.",
    UPLOAD_CHANGED:
      "Skedari ndryshoi ndërsa po e kontrollonim. Ngarkoje përsëri.",
    UPLOAD_CLOSED:
      "Ky ngarkim u zëvendësua ose skadoi. Fillo një ngarkim të ri.",
    CHAT_CLOSED: "Kjo bisedë është mbyllur.",
    CHAT_LIMIT_REACHED: "Kjo bisedë ka arritur kufirin e mesazheve.",
    RATING_NOT_ALLOWED: "Ky udhëtim nuk mund të vlerësohet.",
    RATING_LOCKED: "Ky vlerësim nuk mund të ndryshohet më.",
    TIP_NOT_ALLOWED: "Nuk mund të shtohet bakshish për këtë udhëtim.",
    TIP_ALREADY_PAID: "Ke dhënë tashmë bakshish për këtë udhëtim.",
    TIP_IN_PROGRESS: "Një pagesë bakshishi është tashmë në proces.",
    TIP_CANCELED: "Ky bakshish u anulua.",
    REPORT_WINDOW_CLOSED: "Koha për të raportuar këtë udhëtim ka kaluar.",
    CANNOT_REPORT_OWN_MESSAGE: "Nuk mund të raportosh mesazhin tënd.",
    TOO_MANY_SHARES:
      "Ke arritur kufirin e lidhjeve të ndarjes për këtë udhëtim.",
    SHARE_UNAVAILABLE: "Ky udhëtim nuk mund të ndahet tani.",
    SHARE_NOT_AVAILABLE: "Kjo lidhje nuk është më e disponueshme.",
    PLACE_LIMIT:
      "Ke arritur kufirin e vendeve të ruajtura. Fshi një për të shtuar një tjetër.",
    LABEL_NOT_EDITABLE: "Shtëpia dhe Puna nuk mund të riemërtohen.",
    SUPPORT_CLOSED: "Kjo kërkesë për ndihmë është mbyllur.",
    PIN_REQUIRED: "Shkruaj PIN-in e pasagjerit për të filluar.",
    PIN_INCORRECT: "Ky PIN nuk përputhet. Kërkoji pasagjerit ta lexojë sërish.",
    PIN_LOCKED: "Shumë PIN-e të pasakta. Prit pak para se të provosh përsëri.",
    PIN_BLOCKED:
      "Futja e PIN-it është bllokuar për këtë marrje. Kontakto ndihmën ose anulo udhëtimin.",
    PIN_UNAVAILABLE:
      "PIN-i i udhëtimit nuk mund të kontrollohet tani. Kontakto ndihmën.",
    ATTACHMENT_LIMIT: "Ke arritur kufirin e fotove për këtë kërkesë.",
    ATTACHMENT_NOT_READY:
      "Njëra nga fotot nuk është e disponueshme. Hiqe dhe shtoje përsëri.",
    ATTACHMENT_SENT: "Një foto që është dërguar nuk mund të hiqet.",
    CATEGORY_REQUIRED: "Zgjidh të paktën një kategori automjeti.",
    CATEGORY_UNAVAILABLE:
      "Kjo kategori automjeti nuk ofrohet këtu tani. Zgjidh një tjetër.",
    TOO_MANY_PASSENGERS:
      "Kjo kategori automjeti nuk ka vende për kaq pasagjerë.",
    STOPS_TOO_CLOSE:
      "Dy vende radhazi në këtë udhëtim janë të njëjta ose shumë afër njëra-tjetrës.",
    STOP_OUTSIDE_SERVICE_AREA:
      "Njëra nga ndalesat është jashtë zonës që shërbejmë nga pika jote e nisjes.",
    STOPS_REMAINING:
      "Shëno çdo ndalesë si të arritur para se të përfundosh udhëtimin.",
    STOP_OUT_OF_ORDER:
      "Kjo ndalesë është përditësuar tashmë. Po shfaqet gjendja më e fundit.",
    SCHEDULE_TOO_SOON:
      "Kjo orë është shumë afër për t'u planifikuar. Zgjidh një orë më vonë ose kërko udhëtim tani.",
    SCHEDULE_TOO_FAR: "Kjo orë është shumë larg për t'u planifikuar.",
    SCHEDULE_TIME_SKIPPED:
      "Kjo orë nuk ekziston atë ditë sepse ora shtyhet përpara. Zgjidh një orë tjetër.",
    SCHEDULE_TIME_AMBIGUOUS:
      "Kjo orë ndodh dy herë atë ditë sepse ora kthehet mbrapsht. Zgjidh të parën ose të dytën.",
    SCHEDULE_LIMIT:
      "Ke arritur kufirin e kërkesave të planifikuara. Anulo një për të shtuar një tjetër.",
    SCHEDULE_OVERLAP: "Ke tashmë një kërkesë të planifikuar afër kësaj ore.",
    SCHEDULE_CLOSED:
      "Kjo kërkesë e planifikuar ka përfunduar. Nuk u tarifua asgjë për të.",
    SCHEDULE_NOT_OPEN:
      "Është herët për ta konfirmuar këtë kërkesë. Do të të kujtojmë kur të hapet.",
    DELETION_BLOCKED: "Llogaria jote nuk mund të fshihet ende.",
    REAUTH_REQUIRED: "Të lutem konfirmo sërish identitetin për të vazhduar.",
    VERSION_CONFLICT:
      "Kjo ka ndryshuar që kur e hape. Ringarkoje dhe provo përsëri.",
  },
);
