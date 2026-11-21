"use client";

import { useRafraichir } from "../../../../components/formulaires/useRafraichir";
import { useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { CodesSecours } from "../../../../components/securite/CodesSecours";
import { QrCodeTotp } from "../../../../components/securite/QrCodeTotp";
import { Alerte } from "../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { Bouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import { api } from "../../../../lib/api";
import { formaterDate } from "../../../../lib/format";
import {
  grouperSecret,
  messageSpecifiqueGestion,
  validerConfirmation,
  validerFacteur,
  validerMotDePasse,
  type EtatTfa,
  type FacteurSaisi,
} from "../../../../lib/double-authentification";

/**
 * Carte de la double authentification. L'état « activée » est aussi suivi localement : les
 * codes de secours restent affichés (sans rafraîchir la page) jusqu'à « Terminer », tandis que
 * le badge passe déjà à « Activée ».
 */
export function CarteDoubleAuthentification({ etat, email }: { etat: EtatTfa; email: string }) {
  const t = useT();
  const langue = useLangue();
  const [activeeIci, setActiveeIci] = useState(false);
  const active = etat.active || activeeIci;
  return (
    <Carte
      titre={t("Double authentification", "Two-factor authentication")}
      actions={
        active ? (
          <BadgeStatut tonalite="succes">{t("Activée", "Enabled")}</BadgeStatut>
        ) : (
          <BadgeStatut tonalite={etat.obligatoire ? "danger" : "neutre"}>
            {etat.obligatoire
              ? t("Désactivée – exigée par le cabinet", "Disabled – required by the firm")
              : t("Désactivée", "Disabled")}
          </BadgeStatut>
        )
      }
    >
      {etat.active ? (
        <div className="mp-pile">
          <dl className="mp-liste-def">
            <div>
              <dt>{t("Activée le", "Enabled on")}</dt>
              <dd>{formaterDate(etat.activee_le, "Africa/Abidjan", langue)}</dd>
            </div>
            <div>
              <dt>{t("Codes de secours restants", "Backup codes remaining")}</dt>
              <dd>
                {t(`${etat.codes_secours_restants} sur 10`, `${etat.codes_secours_restants} of 10`)}
              </dd>
            </div>
          </dl>
          <GestionTfaActive
            email={email}
            obligatoire={etat.obligatoire}
            codesRestants={etat.codes_secours_restants}
          />
        </div>
      ) : (
        <ActivationTfa
          email={email}
          obligatoire={etat.obligatoire}
          onActivee={() => setActiveeIci(true)}
        />
      )}
    </Carte>
  );
}

interface Secret {
  secret: string;
  uri: string;
}

type EtapeActivation =
  | { etape: "repos" }
  | { etape: "mot_de_passe" }
  | { etape: "scan"; secret: Secret }
  | { etape: "codes"; codes: string[] };

/**
 * Activation en deux temps : mot de passe → secret et QR code (affichés une fois) → code de
 * l'application → 10 codes de secours (affichés une fois). Secret et codes ne vivent que dans
 * l'état de ce composant ; la page n'est rafraîchie qu'après « Terminer ».
 */
export function ActivationTfa({
  email,
  obligatoire,
  onActivee,
}: {
  email: string;
  obligatoire: boolean;
  onActivee: () => void;
}) {
  const t = useT();
  const { rafraichir } = useRafraichir();
  const [etat, setEtat] = useState<EtapeActivation>({ etape: "repos" });

  if (etat.etape === "codes") {
    return (
      <CodesSecours
        codes={etat.codes}
        email={email}
        onTerminer={() => {
          setEtat({ etape: "repos" });
          rafraichir();
        }}
      />
    );
  }
  if (etat.etape === "scan") {
    return (
      <EtapeScan
        secret={etat.secret}
        onActivee={(codes) => {
          onActivee();
          setEtat({ etape: "codes", codes });
        }}
        onAnnuler={() => setEtat({ etape: "repos" })}
      />
    );
  }
  if (etat.etape === "mot_de_passe") {
    return (
      <EtapeMotDePasse
        onSecret={(secret) => setEtat({ etape: "scan", secret })}
        onAnnuler={() => setEtat({ etape: "repos" })}
      />
    );
  }
  return (
    <div className="mp-pile">
      <p>
        {obligatoire
          ? t(
              "Votre cabinet exige la double authentification pour votre rôle. Activez-la maintenant : cela prend deux minutes.",
              "Your firm requires two-factor authentication for your role. Turn it on now: it takes two minutes.",
            )
          : t(
              "Recommandée : même si votre mot de passe fuit, personne ne peut se connecter sans votre téléphone.",
              "Recommended: even if your password leaks, no one can sign in without your phone.",
            )}
      </p>
      <p className="mp-texte-doux">
        {t(
          "Il vous faut une application d'authentification sur votre téléphone (Google Authenticator, Microsoft Authenticator, FreeOTP…).",
          "You need an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, FreeOTP…).",
        )}
      </p>
      <div>
        <Bouton icone="cadenas" onClick={() => setEtat({ etape: "mot_de_passe" })}>
          {t("Activer la double authentification", "Turn on two-factor authentication")}
        </Bouton>
      </div>
    </div>
  );
}

function EtapeMotDePasse({
  onSecret,
  onAnnuler,
}: {
  onSecret: (s: Secret) => void;
  onAnnuler: () => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [motDePasse, setMotDePasse] = useState("");
  const f = useFormulaire<"mot_de_passe">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const ok = await f.envoyer(
      validerMotDePasse(motDePasse, langue),
      (c) => api.post<Secret>("/api/auth/2fa/initialiser", c, { redirigerSi401: false }),
      {
        rafraichir: false,
        apres: onSecret,
        messageSpecifique: messageSpecifiqueGestion("totp", langue),
      },
    );
    if (!ok) setMotDePasse("");
  }
  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <p className="mp-sous-formulaire__titre">
        {t("Étape 1 sur 3 : confirmez votre identité", "Step 1 of 3: confirm your identity")}
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Refusé", "Refused")}
      />
      <Champ
        libelle={t("Mot de passe", "Password")}
        type="password"
        autoComplete="current-password"
        required
        autoFocus
        value={motDePasse}
        onChange={(e) => setMotDePasse(e.target.value)}
        erreur={f.erreurs.mot_de_passe}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Vérification…", "Verifying…")}
        >
          {t("Continuer", "Continue")}
        </Bouton>
        <Bouton variante="discret" onClick={onAnnuler}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

function EtapeScan({
  secret,
  onActivee,
  onAnnuler,
}: {
  secret: Secret;
  onActivee: (codes: string[]) => void;
  onAnnuler: () => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [code, setCode] = useState("");
  const f = useFormulaire<"code">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = validerFacteur(code, "totp", langue);
    const ok = await f.envoyer(
      v,
      (c) =>
        api.post<{ codes_secours: string[] }>("/api/auth/2fa/activer", c, {
          redirigerSi401: false,
        }),
      {
        rafraichir: false,
        apres: (r) => onActivee(r.codes_secours),
        messageSpecifique: messageSpecifiqueGestion("totp", langue),
      },
    );
    if (!ok) setCode("");
  }
  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <p className="mp-sous-formulaire__titre">
        {t(
          "Étape 2 sur 3 : ajoutez CabinetPilot à votre application",
          "Step 2 of 3: add CabinetPilot to your app",
        )}
      </p>
      <div className="mp-qrcode-bloc">
        <QrCodeTotp uri={secret.uri} />
        <div className="mp-pile">
          <p>
            {t(
              "Scannez ce QR code avec votre application d'authentification.",
              "Scan this QR code with your authenticator app.",
            )}
          </p>
          <p className="mp-texte-doux">
            {t("Impossible de scanner ? Saisissez cette clé :", "Can't scan? Enter this key:")}
          </p>
          <p>
            <code className="mp-secret">{grouperSecret(secret.secret)}</code>
          </p>
          <p className="mp-texte-petit mp-texte-doux">
            {t(
              "Type : basé sur le temps · 6 chiffres · 30 secondes. Cette clé n'est affichée qu'une fois.",
              "Type: time-based · 6 digits · 30 seconds. This key is shown only once.",
            )}
          </p>
        </div>
      </div>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Code refusé", "Code rejected")}
      />
      <Champ
        libelle={t("Code à 6 chiffres affiché par l'application", "6-digit code shown by the app")}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        required
        className="mp-champ-code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
        erreur={f.erreurs.code}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Activation…", "Turning on…")}
        >
          {t("Activer", "Turn on")}
        </Bouton>
        <Bouton variante="discret" onClick={onAnnuler}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

type ActionTfa = "codes" | "desactiver";

/** 2FA active : régénérer les codes de secours ou désactiver (mot de passe + second facteur). */
export function GestionTfaActive({
  email,
  obligatoire,
  codesRestants,
}: {
  email: string;
  obligatoire: boolean;
  codesRestants: number;
}) {
  const t = useT();
  const { rafraichir } = useRafraichir();
  const [action, setAction] = useState<ActionTfa | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  if (codes) {
    return (
      <CodesSecours
        codes={codes}
        email={email}
        onTerminer={() => {
          setCodes(null);
          rafraichir();
        }}
      />
    );
  }
  return (
    <div className="mp-pile">
      {codesRestants <= 3 ? (
        <Alerte
          tonalite="attention"
          annonce="aucune"
          titre={t("Peu de codes de secours restants", "Few backup codes left")}
        >
          <p>
            {t(
              "Régénérez vos codes pour ne pas risquer de perdre l'accès à votre compte.",
              "Regenerate your codes so you do not risk losing access to your account.",
            )}
          </p>
        </Alerte>
      ) : null}
      {action ? (
        <FormulaireConfirmation
          action={action}
          obligatoire={obligatoire}
          onCodes={(c) => {
            setAction(null);
            setCodes(c);
          }}
          onAnnuler={() => setAction(null)}
        />
      ) : (
        <div className="mp-barre-actions">
          <Bouton variante="secondaire" icone="copie" onClick={() => setAction("codes")}>
            {t("Régénérer les codes de secours", "Regenerate backup codes")}
          </Bouton>
          <Bouton variante="secondaire" icone="cadenas" onClick={() => setAction("desactiver")}>
            {t("Désactiver la double authentification", "Turn off two-factor authentication")}
          </Bouton>
        </div>
      )}
    </div>
  );
}

function FormulaireConfirmation({
  action,
  obligatoire,
  onCodes,
  onAnnuler,
}: {
  action: ActionTfa;
  obligatoire: boolean;
  onCodes: (codes: string[]) => void;
  onAnnuler: () => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [motDePasse, setMotDePasse] = useState("");
  const [code, setCode] = useState("");
  const [facteur, setFacteur] = useState<FacteurSaisi>("totp");
  const f = useFormulaire<"mot_de_passe" | "code">();
  const desactiver = action === "desactiver";

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const ok = await f.envoyer(
      validerConfirmation({ motDePasse, code, facteur }, langue),
      (c) =>
        desactiver
          ? api.post("/api/auth/2fa/desactiver", c, { redirigerSi401: false })
          : api.post<{ codes_secours: string[] }>("/api/auth/2fa/codes-secours", c, {
              redirigerSi401: false,
            }),
      {
        rafraichir: desactiver,
        succes: desactiver
          ? t("Double authentification désactivée.", "Two-factor authentication turned off.")
          : undefined,
        apres: (r) => {
          if (!desactiver) onCodes((r as { codes_secours: string[] }).codes_secours);
        },
        messageSpecifique: messageSpecifiqueGestion(facteur, langue),
      },
    );
    setMotDePasse("");
    if (!ok) setCode("");
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
    >
      <p className="mp-sous-formulaire__titre">
        {desactiver
          ? t("Désactiver la double authentification", "Turn off two-factor authentication")
          : t("Régénérer les codes de secours", "Regenerate backup codes")}
      </p>
      {desactiver ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>
            {obligatoire
              ? t(
                  "Votre cabinet exige la double authentification pour votre rôle : vous serez invité à la réactiver.",
                  "Your firm requires two-factor authentication for your role: you will be asked to turn it back on.",
                )
              : t(
                  "Votre compte ne sera plus protégé que par votre mot de passe.",
                  "Your account will only be protected by your password.",
                )}
          </p>
        </Alerte>
      ) : (
        <p className="mp-texte-doux">
          {t(
            "Vos anciens codes de secours cesseront de fonctionner.",
            "Your old backup codes will stop working.",
          )}
        </p>
      )}
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Refusé", "Refused")}
      />
      <Champ
        libelle={t("Mot de passe", "Password")}
        type="password"
        autoComplete="current-password"
        required
        autoFocus
        value={motDePasse}
        onChange={(e) => setMotDePasse(e.target.value)}
        erreur={f.erreurs.mot_de_passe}
      />
      <Champ
        key={facteur}
        libelle={
          facteur === "totp"
            ? t("Code à 6 chiffres de l'application", "6-digit code from the app")
            : t("Code de secours", "Backup code")
        }
        inputMode={facteur === "totp" ? "numeric" : "text"}
        autoComplete={facteur === "totp" ? "one-time-code" : "off"}
        maxLength={facteur === "totp" ? 7 : 40}
        required
        spellCheck={false}
        className={facteur === "totp" ? "mp-champ-code" : undefined}
        aide={
          facteur === "totp"
            ? t("Le code change toutes les 30 secondes.", "The code changes every 30 seconds.")
            : t(
                "Format : abcde-12345 (tirets et majuscules acceptés).",
                "Format: abcde-12345 (hyphens and capital letters accepted).",
              )
        }
        value={code}
        onChange={(e) =>
          setCode(facteur === "totp" ? e.target.value.replace(/[^\d ]/g, "") : e.target.value)
        }
        erreur={f.erreurs.code}
      />
      <div>
        <Bouton
          variante="discret"
          onClick={() => {
            setFacteur((x) => (x === "totp" ? "secours" : "totp"));
            setCode("");
          }}
        >
          {facteur === "totp"
            ? t("Utiliser un code de secours", "Use a backup code")
            : t("Utiliser le code de l'application", "Use the app code")}
        </Bouton>
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante={desactiver ? "danger" : "primaire"}
          chargement={f.enCours}
          texteChargement={t("Vérification…", "Verifying…")}
        >
          {desactiver
            ? t("Oui, désactiver", "Yes, turn off")
            : t("Générer de nouveaux codes", "Generate new codes")}
        </Bouton>
        <Bouton variante="discret" onClick={onAnnuler}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
