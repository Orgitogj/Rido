import { formatCents } from "../shared/contracts";
import { appCurrency, formatAmount } from "../shared/currency";

export interface NotificationText {
  title: string;
  body: string;
  sq: { title: string; body: string };
}

const sqMoney = (cents: number) =>
  appCurrency() === "all"
    ? formatAmount(cents, "all", "sq-AL")
    : `${formatCents(cents).replace("$", "").replace(/,/g, " ").replace(".", ",")} USD`;

const text = (
  title: string,
  body: string,
  sqTitle: string,
  sqBody: string,
): NotificationText => ({ title, body, sq: { title: sqTitle, body: sqBody } });

interface DriverInfo {
  display_name: string;
  vehicle_plate: string;
}

export const NOTIFY = {
  rideAccepted: (driver: DriverInfo | null) =>
    text(
      "Driver on the way",
      driver
        ? `${driver.display_name} accepted your ride (${driver.vehicle_plate}).`
        : "A driver accepted your ride.",
      "Shoferi po vjen",
      driver
        ? `${driver.display_name} e pranoi udhëtimin tënd (${driver.vehicle_plate}).`
        : "Një shofer e pranoi udhëtimin tënd.",
    ),
  rideArrived: (driver: DriverInfo | null) =>
    text(
      "Your driver has arrived",
      driver
        ? `Meet ${driver.display_name} at the pickup (${driver.vehicle_plate}).`
        : "Your driver is at the pickup.",
      "Shoferi yt ka mbërritur",
      driver
        ? `Takohu me ${driver.display_name} te pika e nisjes (${driver.vehicle_plate}).`
        : "Shoferi yt është te pika e nisjes.",
    ),
  rideStarted: () =>
    text(
      "Trip started",
      "Enjoy your ride.",
      "Udhëtimi filloi",
      "Udhëtim të mbarë.",
    ),
  rideCompleted: (fareCents: number, inVehicle = false) =>
    text(
      "Trip completed",
      inVehicle
        ? `Thanks for riding. Pay the driver ${formatCents(fareCents)} by card or cash.`
        : `Thanks for riding. Fare: ${formatCents(fareCents)}.`,
      "Udhëtimi përfundoi",
      inVehicle
        ? `Faleminderit që udhëtove me ne. Paguaji shoferit ${sqMoney(fareCents)} me kartë ose para në dorë.`
        : `Faleminderit që udhëtove me ne. Çmimi: ${sqMoney(fareCents)}.`,
    ),
  noDriver: (inVehicle = false) =>
    text(
      "No drivers available",
      inVehicle
        ? "Nobody accepted your request. There is nothing to pay."
        : "Nobody accepted your request. The hold on your card is being released.",
      "Nuk ka shoferë të lirë",
      inVehicle
        ? "Askush nuk e pranoi kërkesën. Nuk ka asgjë për të paguar."
        : "Askush nuk e pranoi kërkesën. Bllokimi në kartën tënde po lirohet.",
    ),
  cancelledByPassenger: () =>
    text(
      "Ride cancelled",
      "The passenger cancelled this ride.",
      "Udhëtimi u anulua",
      "Pasagjeri e anuloi këtë udhëtim.",
    ),
  cancelledByDriver: (inVehicle = false) =>
    text(
      "Ride cancelled",
      inVehicle
        ? "Your driver cancelled and we couldn't assign another one. There is nothing to pay."
        : "Your driver cancelled and we couldn't assign another one. The hold on your card is being released.",
      "Udhëtimi u anulua",
      inVehicle
        ? "Shoferi e anuloi dhe nuk gjetëm dot një tjetër. Nuk ka asgjë për të paguar."
        : "Shoferi e anuloi dhe nuk gjetëm dot një tjetër. Bllokimi në kartën tënde po lirohet.",
    ),
  cancelledBySystem: (inVehicle = false) =>
    text(
      "Ride cancelled",
      inVehicle
        ? "Your request ended. There is nothing to pay."
        : "Your request ended. The hold on your card is being released.",
      "Udhëtimi u anulua",
      inVehicle
        ? "Kërkesa jote përfundoi. Nuk ka asgjë për të paguar."
        : "Kërkesa jote përfundoi. Bllokimi në kartën tënde po lirohet.",
    ),
  rematching: (byDriver: boolean) =>
    text(
      "Finding you another driver",
      byDriver
        ? "Your driver cancelled. We're looking for another driver now; your price hasn't changed."
        : "Your driver can't complete this ride. We're looking for another driver now; your price hasn't changed.",
      "Po të gjejmë një shofer tjetër",
      byDriver
        ? "Shoferi e anuloi. Po kërkojmë një shofer tjetër; çmimi yt nuk ka ndryshuar."
        : "Shoferi nuk mund ta kryejë këtë udhëtim. Po kërkojmë një shofer tjetër; çmimi yt nuk ka ndryshuar.",
    ),
  interrupted: (inVehicle = false) =>
    text(
      "Trip ended early",
      inVehicle
        ? "Your driver ended the trip early. There is nothing to pay for this trip."
        : "Your driver ended the trip early. The hold on your card is being released; your receipt will confirm it.",
      "Udhëtimi përfundoi para kohe",
      inVehicle
        ? "Shoferi e ndërpreu udhëtimin para kohe. Nuk ka asgjë për të paguar për këtë udhëtim."
        : "Shoferi e ndërpreu udhëtimin para kohe. Bllokimi në kartën tënde po lirohet; fatura do ta konfirmojë.",
    ),
  scheduledConfirm: (clock: string) =>
    text(
      "Confirm your scheduled ride",
      `Your ${clock} pickup is coming up. Open the app to see the current price and confirm payment. A driver is requested only after you confirm.`,
      "Konfirmo udhëtimin e planifikuar",
      `Marrja jote e orës ${clock} po afron. Hap aplikacionin për të parë çmimin aktual dhe për të konfirmuar pagesën. Shoferi kërkohet vetëm pasi të konfirmosh.`,
    ),
  scheduledExpired: (reason: string) =>
    text(
      "Scheduled ride not requested",
      reason === "not_confirmed" || reason === "missed_window"
        ? "Your scheduled request wasn't confirmed in time, so no driver was requested. Nothing was charged."
        : "Your scheduled request can't be served any more, so no driver was requested. Nothing was charged.",
      "Udhëtimi i planifikuar nuk u kërkua",
      reason === "not_confirmed" || reason === "missed_window"
        ? "Kërkesa e planifikuar nuk u konfirmua në kohë, ndaj nuk u kërkua shofer. Nuk u tarifua asgjë."
        : "Kërkesa e planifikuar nuk mund të shërbehet më, ndaj nuk u kërkua shofer. Nuk u tarifua asgjë.",
    ),
  pinWaived: () =>
    text(
      "Trip PIN not needed",
      "Support allowed your driver to start this trip without the PIN. Contact support if you didn't expect this.",
      "PIN-i i udhëtimit nuk nevojitet",
      "Ekipi i ndihmës e lejoi shoferin ta fillojë këtë udhëtim pa PIN. Kontakto ndihmën nëse nuk e prisje këtë.",
    ),
  offer: (fareCents: number, distanceMeters: number) =>
    text(
      "New ride request",
      `${formatCents(fareCents)} · pickup about ${(distanceMeters / 1000).toFixed(1)} km away`,
      "Kërkesë e re për udhëtim",
      `${sqMoney(fareCents)} · nisja rreth ${(distanceMeters / 1000).toFixed(1).replace(".", ",")} km larg`,
    ),
  holdReleased: (fareCents: number) =>
    text(
      "Hold released",
      `The ${formatCents(fareCents)} hold on your card has been released. You were not charged.`,
      "Bllokimi u lirua",
      `Bllokimi prej ${sqMoney(fareCents)} në kartën tënde u lirua. Nuk u tarifove.`,
    ),
  chatMessage: (fromPassenger: boolean) =>
    text(
      fromPassenger
        ? "New message from your passenger"
        : "New message from your driver",
      "Open the app to read it.",
      fromPassenger
        ? "Mesazh i ri nga pasagjeri yt"
        : "Mesazh i ri nga shoferi yt",
      "Hap aplikacionin për ta lexuar.",
    ),
  application: (
    action: "approve" | "request_changes" | "reject" | "suspend" | "reinstate",
  ) =>
    ({
      approve: text(
        "Driver application approved",
        "You can now go online and receive ride requests.",
        "Aplikimi si shofer u miratua",
        "Tani mund të dalësh në linjë dhe të marrësh kërkesa për udhëtime.",
      ),
      request_changes: text(
        "Changes requested on your application",
        "Open the Drive screen to see what needs updating.",
        "Kërkohen ndryshime në aplikimin tënd",
        "Hap ekranin Drejto për të parë çfarë duhet përditësuar.",
      ),
      reject: text(
        "Driver application not approved",
        "Open the Drive screen for details.",
        "Aplikimi si shofer nuk u miratua",
        "Hap ekranin Drejto për detaje.",
      ),
      suspend: text(
        "Driver account suspended",
        "You can't go online for now. Open the Drive screen for details.",
        "Llogaria e shoferit u pezullua",
        "Për momentin nuk mund të dalësh në linjë. Hap ekranin Drejto për detaje.",
      ),
      reinstate: text(
        "Driver account reinstated",
        "You can go online again.",
        "Llogaria e shoferit u riaktivizua",
        "Mund të dalësh sërish në linjë.",
      ),
    })[action],
  support: (event: "reply" | "resolved" | "reopened" | "in_progress") =>
    ({
      reply: text(
        "New reply to your support request",
        "Open the request to read it.",
        "Përgjigje e re për kërkesën tënde",
        "Hap kërkesën për ta lexuar.",
      ),
      resolved: text(
        "Support request resolved",
        "Open the request to see the outcome.",
        "Kërkesa për ndihmë u zgjidh",
        "Hap kërkesën për të parë përfundimin.",
      ),
      reopened: text(
        "Support request reopened",
        "We're looking at your request again.",
        "Kërkesa për ndihmë u rihap",
        "Po e shqyrtojmë sërish kërkesën tënde.",
      ),
      in_progress: text(
        "We're working on your support request",
        "A team member has picked it up.",
        "Po punojmë për kërkesën tënde",
        "Një anëtar i ekipit e ka marrë përsipër.",
      ),
    })[event],
  safety: (status: "in_review" | "resolved" | "dismissed" | "open") =>
    text(
      "Update on your safety report",
      status === "in_review"
        ? "Your report is being reviewed."
        : status === "open"
          ? "Your report was reopened."
          : "Your report has been closed. Open the app to see its status.",
      "Përditësim për raportin tënd të sigurisë",
      status === "in_review"
        ? "Raporti yt po shqyrtohet."
        : status === "open"
          ? "Raporti yt u rihap."
          : "Raporti yt u mbyll. Hap aplikacionin për të parë gjendjen.",
    ),
};
