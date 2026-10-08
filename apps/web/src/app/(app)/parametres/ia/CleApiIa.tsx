"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { ChampsReconfirmation } from "../../../../components/securite/ChampsReconfirmation";
import { Bouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import { SAISIE_CONFIRMATION_VIDE } from "../../../../lib/double-authentification";
import { formaterDateHeure } from "../../../../lib/format";
import { libelleSourceCle, validerCleApi, type ParametresIa } from "../../../../lib/ia";
import { useEnregistrementIa } from "./useEnregistrementIa";

type Ouvert = "cle" | "retrait" | null;

/**
 * Clé API OpenRouter du cabinet : saisie, remplacement ou retrait, toujours avec
 * reconfirmation de l'identité. La clé saisie ne vit que dans l'état de ce formulaire : champ
 * masqué sans attribut `name` (jamais dans une URL, même si la page n'est pas encore active),
 * effacée après l'envoi, jamais réaffichée ni conservée par le navigateur.
 */
export function CleApiIa({ parametres }: { parametres: ParametresIa }) {
  const [ouvert, setOuvert] = useState<Ouvert>(null);
  const [cle, setCle] = useState("");
  const e = useEnregistrementIa<"cle_api">();
  const refCle = useRef<HTMLInputElement>(null);
  const refOuvrir = useRef<HTMLButtonElement>(null);
  const [rendreFocus, setRendreFocus] = useState(false);
  const remplacer = parametres.cle_configuree;

  useEffect(() => {
    if (ouvert === "cle") refCle.current?.focus();
    else if (ouvert === null && rendreFocus) refOuvrir.current?.focus();
  }, [ouvert, rendreFocus]);

  function ouvrir(o: Ouvert) {
    setCle("");
    e.setConfirmation(null);
    e.f.effacerSucces();
    setRendreFocus(o === null);
    setOuvert(o);
  }

  async function enregistrerCle(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const ok = await e.enregistrer(validerCleApi(cle), {
      succes: `${remplacer ? "Clé du cabinet remplacée" : "Clé du cabinet enregistrée"}. Les associés en sont avertis.`,
      exigerConfirmation: true,
    });
    if (ok) {
      setCle("");
      setRendreFocus(true);
      setOuvert(null);
    }
  }

  async function retirer(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const ok = await e.enregistrer(
      { ok: true, charge: { cle_api: null } },
      { succes: "Clé du cabinet retirée. Les associés en sont avertis.", exigerConfirmation: true },
    );
    if (ok) {
      setRendreFocus(true);
      setOuvert(null);
    }
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire erreur={e.f.erreurGlobale} succes={e.f.succes} refAlerte={e.f.refAlerte} />
      <dl className="mp-liste-def">
        <div>
          <dt>Clé du cabinet</dt>
          <dd>
            {!parametres.cle_configuree
              ? "Aucune"
              : `Enregistrée${parametres.cle_modifiee_le ? ` le ${formaterDateHeure(parametres.cle_modifiee_le)}` : ""} ; chiffrée, elle n'est jamais réaffichée.`}
          </dd>
        </div>
        <div>
          <dt>Clé de la plateforme</dt>
          <dd>
            {parametres.cle_plateforme_disponible
              ? "Disponible : utilisée quand le cabinet n'a pas de clé."
              : "Non fournie"}
          </dd>
        </div>
        <div>
          <dt>Clé utilisée</dt>
          <dd>{libelleSourceCle(parametres.source_cle)}</dd>
        </div>
      </dl>
      {parametres.cle_configuree ? (
        <p className="mp-texte-petit mp-texte-doux">
          Si le test de connexion ou une alerte signale une clé illisible, enregistrez-la de nouveau
          : la clé de la plateforme ne la remplace jamais.
        </p>
      ) : null}
      {ouvert === "cle" ? (
        <form
          ref={e.f.refFormulaire}
          className="mp-formulaire mp-sous-formulaire"
          method="post"
          noValidate
          autoComplete="off"
          onSubmit={enregistrerCle}
        >
          <Champ
            ref={refCle}
            libelle={remplacer ? "Nouvelle clé API OpenRouter" : "Clé API OpenRouter"}
            aide="Créée dans votre compte OpenRouter (rubrique « Keys »). Elle est chiffrée par le serveur et ne sera plus jamais affichée. Les associés sont avertis de tout changement."
            type="password"
            required
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={250}
            data-1p-ignore=""
            data-lpignore="true"
            value={cle}
            onChange={(ev) => setCle(ev.target.value)}
            erreur={e.f.erreurs.cle_api}
          />
          <ChampsReconfirmation
            saisie={e.confirmation ?? SAISIE_CONFIRMATION_VIDE}
            onChange={e.setConfirmation}
            erreurs={e.f.erreurs}
            motif={
              remplacer ? "remplacer la clé API du cabinet" : "enregistrer la clé API du cabinet"
            }
          />
          <div className="mp-actions-formulaire">
            <Bouton type="submit" chargement={e.f.enCours} texteChargement="Enregistrement…">
              {remplacer ? "Remplacer la clé" : "Enregistrer la clé"}
            </Bouton>
            <Bouton variante="secondaire" disabled={e.f.enCours} onClick={() => ouvrir(null)}>
              Annuler
            </Bouton>
          </div>
        </form>
      ) : ouvert === "retrait" ? (
        <form
          ref={e.f.refFormulaire}
          className="mp-formulaire mp-sous-formulaire"
          method="post"
          noValidate
          onSubmit={retirer}
        >
          <p className="mp-confirmation__question">Retirer la clé API du cabinet ?</p>
          <p className="mp-texte-petit">
            {parametres.cle_plateforme_disponible
              ? "L'IA utilisera alors la clé de la plateforme MissionPilot."
              : "Sans autre clé disponible, l'IA passera en mode gabarit."}
          </p>
          <ChampsReconfirmation
            saisie={e.confirmation ?? SAISIE_CONFIRMATION_VIDE}
            onChange={e.setConfirmation}
            erreurs={e.f.erreurs}
            motif="retirer la clé API du cabinet"
          />
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              variante="danger"
              chargement={e.f.enCours}
              texteChargement="Retrait…"
            >
              Oui, retirer la clé
            </Bouton>
            <Bouton variante="secondaire" disabled={e.f.enCours} onClick={() => ouvrir(null)}>
              Annuler
            </Bouton>
          </div>
        </form>
      ) : (
        <div className="mp-actions-formulaire">
          <Bouton ref={refOuvrir} icone="cadenas" onClick={() => ouvrir("cle")}>
            {remplacer ? "Remplacer la clé" : "Enregistrer une clé"}
          </Bouton>
          {parametres.cle_configuree ? (
            <Bouton variante="secondaire" icone="corbeille" onClick={() => ouvrir("retrait")}>
              Retirer la clé du cabinet
            </Bouton>
          ) : null}
        </div>
      )}
    </div>
  );
}
