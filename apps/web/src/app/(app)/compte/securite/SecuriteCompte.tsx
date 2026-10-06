"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
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
  messageErreurGestion,
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
  const [activeeIci, setActiveeIci] = useState(false);
  const active = etat.active || activeeIci;
  return (
    <Carte
      titre="Double authentification"
      actions={
        active ? (
          <BadgeStatut tonalite="succes">Activée</BadgeStatut>
        ) : (
          <BadgeStatut tonalite={etat.obligatoire ? "danger" : "neutre"}>
            {etat.obligatoire ? "Désactivée – exigée par le cabinet" : "Désactivée"}
          </BadgeStatut>
        )
      }
    >
      {etat.active ? (
        <div className="mp-pile">
          <dl className="mp-liste-def">
            <div>
              <dt>Activée le</dt>
              <dd>{formaterDate(etat.activee_le, "Africa/Abidjan")}</dd>
            </div>
            <div>
              <dt>Codes de secours restants</dt>
              <dd>{`${etat.codes_secours_restants} sur 10`}</dd>
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
  const router = useRouter();
  const [etat, setEtat] = useState<EtapeActivation>({ etape: "repos" });

  if (etat.etape === "codes") {
    return (
      <CodesSecours
        codes={etat.codes}
        email={email}
        onTerminer={() => {
          setEtat({ etape: "repos" });
          router.refresh();
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
          ? "Votre cabinet exige la double authentification pour votre rôle. Activez-la maintenant : cela prend deux minutes."
          : "Recommandée : même si votre mot de passe fuit, personne ne peut se connecter sans votre téléphone."}
      </p>
      <p className="mp-texte-doux">
        Il vous faut une application d&apos;authentification sur votre téléphone (Google
        Authenticator, Microsoft Authenticator, FreeOTP…).
      </p>
      <div>
        <Bouton icone="cadenas" onClick={() => setEtat({ etape: "mot_de_passe" })}>
          Activer la double authentification
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
  const [motDePasse, setMotDePasse] = useState("");
  const f = useFormulaire<"mot_de_passe">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const ok = await f.envoyer(
      validerMotDePasse(motDePasse),
      (c) => api.post<Secret>("/api/auth/2fa/initialiser", c, { redirigerSi401: false }),
      { rafraichir: false, apres: onSecret, messageSpecifique: (e) => messageErreurGestion(e) },
    );
    if (!ok) setMotDePasse("");
  }
  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <p className="mp-sous-formulaire__titre">Étape 1 sur 3 : confirmez votre identité</p>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} titreErreur="Refusé" />
      <Champ
        libelle="Mot de passe"
        type="password"
        autoComplete="current-password"
        required
        autoFocus
        value={motDePasse}
        onChange={(e) => setMotDePasse(e.target.value)}
        erreur={f.erreurs.mot_de_passe}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Vérification…">
          Continuer
        </Bouton>
        <Bouton variante="discret" onClick={onAnnuler}>
          Annuler
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
  const [code, setCode] = useState("");
  const f = useFormulaire<"code">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = validerFacteur(code, "totp");
    const ok = await f.envoyer(
      v,
      (c) =>
        api.post<{ codes_secours: string[] }>("/api/auth/2fa/activer", c, {
          redirigerSi401: false,
        }),
      {
        rafraichir: false,
        apres: (r) => onActivee(r.codes_secours),
        messageSpecifique: (e) => messageErreurGestion(e),
      },
    );
    if (!ok) setCode("");
  }
  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <p className="mp-sous-formulaire__titre">
        Étape 2 sur 3 : ajoutez MissionPilot à votre application
      </p>
      <div className="mp-qrcode-bloc">
        <QrCodeTotp uri={secret.uri} />
        <div className="mp-pile">
          <p>Scannez ce QR code avec votre application d&apos;authentification.</p>
          <p className="mp-texte-doux">Impossible de scanner ? Saisissez cette clé :</p>
          <p>
            <code className="mp-secret">{grouperSecret(secret.secret)}</code>
          </p>
          <p className="mp-texte-petit mp-texte-doux">
            Type : basé sur le temps · 6 chiffres · 30 secondes. Cette clé n&apos;est affichée
            qu&apos;une fois.
          </p>
        </div>
      </div>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Code refusé"
      />
      <Champ
        libelle="Code à 6 chiffres affiché par l'application"
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
        <Bouton type="submit" chargement={f.enCours} texteChargement="Activation…">
          Activer
        </Bouton>
        <Bouton variante="discret" onClick={onAnnuler}>
          Annuler
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
  const router = useRouter();
  const [action, setAction] = useState<ActionTfa | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  if (codes) {
    return (
      <CodesSecours
        codes={codes}
        email={email}
        onTerminer={() => {
          setCodes(null);
          router.refresh();
        }}
      />
    );
  }
  return (
    <div className="mp-pile">
      {codesRestants <= 3 ? (
        <Alerte tonalite="attention" annonce="aucune" titre="Peu de codes de secours restants">
          <p>Régénérez vos codes pour ne pas risquer de perdre l&apos;accès à votre compte.</p>
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
            Régénérer les codes de secours
          </Bouton>
          <Bouton variante="secondaire" icone="cadenas" onClick={() => setAction("desactiver")}>
            Désactiver la double authentification
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
  const [motDePasse, setMotDePasse] = useState("");
  const [code, setCode] = useState("");
  const [facteur, setFacteur] = useState<FacteurSaisi>("totp");
  const f = useFormulaire<"mot_de_passe" | "code">();
  const desactiver = action === "desactiver";

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const ok = await f.envoyer(
      validerConfirmation({ motDePasse, code, facteur }),
      (c) =>
        desactiver
          ? api.post("/api/auth/2fa/desactiver", c, { redirigerSi401: false })
          : api.post<{ codes_secours: string[] }>("/api/auth/2fa/codes-secours", c, {
              redirigerSi401: false,
            }),
      {
        rafraichir: desactiver,
        succes: desactiver ? "Double authentification désactivée." : undefined,
        apres: (r) => {
          if (!desactiver) onCodes((r as { codes_secours: string[] }).codes_secours);
        },
        messageSpecifique: (e) => messageErreurGestion(e, facteur),
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
        {desactiver ? "Désactiver la double authentification" : "Régénérer les codes de secours"}
      </p>
      {desactiver ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>
            {obligatoire
              ? "Votre cabinet exige la double authentification pour votre rôle : vous serez invité à la réactiver."
              : "Votre compte ne sera plus protégé que par votre mot de passe."}
          </p>
        </Alerte>
      ) : (
        <p className="mp-texte-doux">Vos anciens codes de secours cesseront de fonctionner.</p>
      )}
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Refusé"
      />
      <Champ
        libelle="Mot de passe"
        type="password"
        autoComplete="current-password"
        required
        value={motDePasse}
        onChange={(e) => setMotDePasse(e.target.value)}
        erreur={f.erreurs.mot_de_passe}
      />
      <Champ
        key={facteur}
        libelle={facteur === "totp" ? "Code à 6 chiffres de l'application" : "Code de secours"}
        inputMode={facteur === "totp" ? "numeric" : "text"}
        autoComplete={facteur === "totp" ? "one-time-code" : "off"}
        maxLength={facteur === "totp" ? 7 : 40}
        required
        value={code}
        onChange={(e) => setCode(e.target.value)}
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
          {facteur === "totp" ? "Utiliser un code de secours" : "Utiliser le code de l'application"}
        </Bouton>
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante={desactiver ? "danger" : "primaire"}
          chargement={f.enCours}
          texteChargement="Vérification…"
        >
          {desactiver ? "Oui, désactiver" : "Générer de nouveaux codes"}
        </Bouton>
        <Bouton variante="discret" onClick={onAnnuler}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
