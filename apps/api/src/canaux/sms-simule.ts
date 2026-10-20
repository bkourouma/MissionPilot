import { estGsm7, SMS_LONGUEUR_MAX } from "@missionpilot/engines";
import type { EnvoiSms, PasserelleSms, ResultatEnvoi } from "./ports.js";
import {
  ajouterALaBoite,
  exigerNumeroDeTest,
  idExterneSimule,
  refusDe,
  refusSelonNumero,
  type MessageSimule,
} from "./simule-commun.js";
import type { OptionsCanalSimule } from "./whatsapp-simule.js";

/*
 * PasserelleSmsSimulee (SPEC-3c §4.1) : même mécanique que le WhatsApp simulé (numéros de test
 * seuls, comportement selon les deux derniers chiffres, idempotence), plus la contrainte du SMS :
 * texte en GSM-7 de base (sans accent) et 160 caractères au plus, sinon `GABARIT_REFUSE`. AUCUN
 * envoi réel.
 */
export class PasserelleSmsSimulee implements PasserelleSms {
  readonly fournisseur = "simule";
  readonly mode = "simule" as const;
  readonly boite: MessageSimule[] = [];
  private readonly horloge: () => Date;
  private readonly appels = new Map<string, number>();
  private readonly acceptes = new Map<string, ResultatEnvoi>();

  constructor(options: OptionsCanalSimule = {}) {
    this.horloge = options.horloge ?? (() => new Date());
  }

  async envoyer(envoi: EnvoiSms): Promise<ResultatEnvoi> {
    exigerNumeroDeTest(envoi.numero);
    const deja = this.acceptes.get(envoi.idempotence);
    if (deja) return deja;
    const appel = this.appels.get(envoi.idempotence) ?? 0;
    this.appels.set(envoi.idempotence, appel + 1);
    const refuse = refusSelonNumero(envoi.numero, appel);
    if (refuse) return refuse;
    if (envoi.texte.length > SMS_LONGUEUR_MAX || !estGsm7(envoi.texte)) {
      return refusDe("GABARIT_REFUSE", false);
    }
    const resultat: ResultatEnvoi = {
      statut: "accepte",
      idExterne: idExterneSimule("sim-sms-", envoi.idempotence),
      codeRefus: null,
      reessayable: false,
    };
    this.acceptes.set(envoi.idempotence, resultat);
    ajouterALaBoite(this.boite, {
      idExterne: resultat.idExterne as string,
      compte: envoi.compte,
      numero: envoi.numero,
      gabarit: envoi.gabarit,
      texte: envoi.texte,
      instant: this.horloge(),
    });
    return resultat;
  }
}
