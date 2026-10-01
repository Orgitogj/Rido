import { section } from "../core";

export default section(
  {
    title: "Delete account",
    link: "Delete account",
    intro:
      "Deleting your account removes your sign-in, your name, saved places, notification settings, device registrations, your chat messages and share links.",
    retainedTitle: "What we keep",
    retained:
      "Ride, payment, refund and dispute records, receipts, safety reports, support requests and audit history are kept without your name so payments can be reconciled and open cases investigated. How long they are kept is a policy decision of the operator of this service.",
    driverNote:
      "If you drive, your driver profile is closed, your vehicle details are removed and your documents are scheduled for deletion.",
    blockedTitle: "You can't delete your account yet",
    blocker: {
      ACTIVE_RIDE: "You have a ride in progress. Finish or cancel it first.",
      ACTIVE_DRIVER_RIDE: "You're driving a ride. Finish it first.",
      DRIVER_ONLINE: "You're online as a driver. Go offline first.",
      PAYMENT_IN_PROGRESS:
        "A payment, tip or card release is still being processed. Try again in a few minutes.",
      OPERATOR_ACCOUNT:
        "This account is an operator. An administrator must remove the operator role first.",
    },
    confirmIdentity: "Confirm it's you",
    passwordPrompt: "Enter your password to continue.",
    password: "Password",
    verify: "Confirm password",
    verified: "Identity confirmed.",
    verifyFailed: "That password wasn't accepted. Try again.",
    typeDelete: "Type DELETE to confirm",
    deleteNow: "Delete my account permanently",
    deleting: "Deleting…",
    cannotUndo: "This can't be undone.",
    done: "Your account was deleted.",
    pending:
      "Your account is closed and your data was removed. We're still finishing the removal of your sign-in; you don't need to do anything.",
    loadFailed: "We couldn't check whether your account can be deleted.",
  },
  {
    title: "Fshi llogarinë",
    link: "Fshi llogarinë",
    intro:
      "Fshirja e llogarisë heq hyrjen tënde, emrin, vendet e ruajtura, cilësimet e njoftimeve, regjistrimet e pajisjeve, mesazhet e tua dhe lidhjet e ndarjes.",
    retainedTitle: "Çfarë ruajmë",
    retained:
      "Të dhënat e udhëtimeve, pagesave, rimbursimeve dhe mosmarrëveshjeve, faturat, raportet e sigurisë, kërkesat për ndihmë dhe historiku i auditimit ruhen pa emrin tënd, që pagesat të rakordohen dhe rastet e hapura të hetohen. Sa gjatë ruhen është vendim i operatorit të këtij shërbimi.",
    driverNote:
      "Nëse je shofer, profili yt i shoferit mbyllet, të dhënat e automjetit hiqen dhe dokumentet planifikohen për fshirje.",
    blockedTitle: "Ende nuk mund ta fshish llogarinë",
    blocker: {
      ACTIVE_RIDE:
        "Ke një udhëtim në vazhdim. Fillimisht përfundoje ose anuloje.",
      ACTIVE_DRIVER_RIDE:
        "Po kryen një udhëtim si shofer. Fillimisht përfundoje.",
      DRIVER_ONLINE: "Je në linjë si shofer. Fillimisht dil jashtë linje.",
      PAYMENT_IN_PROGRESS:
        "Një pagesë, bakshish ose lirim karte është ende në përpunim. Provo përsëri pas pak minutash.",
      OPERATOR_ACCOUNT:
        "Kjo llogari është operator. Një administrator duhet të heqë fillimisht rolin e operatorit.",
    },
    confirmIdentity: "Konfirmo që je ti",
    passwordPrompt: "Shkruaj fjalëkalimin për të vazhduar.",
    password: "Fjalëkalimi",
    verify: "Konfirmo fjalëkalimin",
    verified: "Identiteti u konfirmua.",
    verifyFailed: "Ky fjalëkalim nuk u pranua. Provo përsëri.",
    typeDelete: "Shkruaj DELETE për të konfirmuar",
    deleteNow: "Fshije llogarinë time përgjithmonë",
    deleting: "Duke fshirë…",
    cannotUndo: "Ky veprim nuk mund të zhbëhet.",
    done: "Llogaria jote u fshi.",
    pending:
      "Llogaria jote u mbyll dhe të dhënat u hoqën. Po përfundojmë ende heqjen e hyrjes sate; nuk duhet të bësh asgjë.",
    loadFailed: "Nuk e kontrolluam dot nëse llogaria mund të fshihet.",
  },
);
