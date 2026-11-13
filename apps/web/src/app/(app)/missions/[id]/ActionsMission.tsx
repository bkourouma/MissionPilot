"use client";

import { useState } from "react";
import type { StatutMission } from "@missionpilot/shared";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { useT } from "../../../../components/i18n/FournisseurLangue";
import { Alerte } from "../../../../components/ui/Alerte";
import { Bouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import type { OptionSelect } from "../../../../components/ui/Select";
import { api } from "../../../../lib/api";
import type { Devise } from "../../../../lib/format";
import type { DroitsMission, NatureSupplementaire } from "../../../../lib/missions";
import { Duplication, Modele } from "./ActionsMissionCopie";
import { Signature } from "./ActionsMissionSignature";

export interface ActionsMissionProps {
  mission: {
    id: string;
    intitule: string;
    statut: StatutMission;
    devise: Devise;
    directeurDesigne: boolean;
  };
  droits: DroitsMission;
  /** Natures de lignes saisissables à la signature (selon les droits financiers). */
  natures: NatureSupplementaire[];
  /** Saisir un taux de change flottant (USD) : « finance.lire » ou associé. */
  peutSaisirTaux: boolean;
  clients: readonly OptionSelect[];
}

/** Cycle de vie : transitions, signature (budget figé), clôture, duplication, modèle. */
export function ActionsMission({
  mission,
  droits,
  natures,
  peutSaisirTaux,
  clients,
}: ActionsMissionProps) {
  const t = useT();
  const f = useFormulaire<never>();
  const chemin = `/api/missions/${encodeURIComponent(mission.id)}`;
  const [panneau, setPanneau] = useState<"aucun" | "duplication" | "modele">("aucun");
  // Conservé au niveau de la carte : après signature, le formulaire disparaît (statut « signée »).
  const [signee, setSignee] = useState(false);
  const [attente, marquerAttente] = useAttenteRafraichissement(mission.statut);
  const rien =
    droits.transitions.length === 0 &&
    !droits.signer &&
    !droits.cloturer &&
    !droits.dupliquer &&
    !droits.enregistrerModele;
  if (rien) return null;

  return (
    <Carte titre={t("Cycle de vie", "Lifecycle")}>
      <div className="mp-pile">
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur={t("Action impossible", "Action not possible")}
        />
        {signee ? (
          <Alerte
            tonalite="succes"
            titre={t("Lettre de mission signée", "Engagement letter signed")}
          >
            <p>
              {t(
                "Le budget initial est figé (version 1). Consultez-le dans l'onglet Budget.",
                "The initial budget is locked (version 1). View it in the Budget tab.",
              )}
            </p>
          </Alerte>
        ) : null}
        {attente ? (
          <p className="mp-texte-doux" role="status">
            {t("Mise à jour de la page…", "Updating the page…")}
          </p>
        ) : droits.transitions.length > 0 || droits.cloturer ? (
          <div className="mp-barre-actions">
            {droits.transitions.map((tr) => (
              <Bouton
                key={tr.cible}
                variante="secondaire"
                chargement={f.enCours}
                texteChargement={t("Mise à jour…", "Updating…")}
                onClick={() =>
                  f.envoyer(
                    { ok: true, charge: { statut: tr.cible } },
                    (c) => api.post(`${chemin}/statut`, c),
                    {
                      succes: t("Statut mis à jour.", "Status updated."),
                      apres: marquerAttente,
                    },
                  )
                }
              >
                {tr.libelle}
              </Bouton>
            ))}
            {droits.cloturer ? (
              <BoutonConfirmation
                libelle={t("Clôturer la mission", "Close the engagement")}
                icone="cadenas"
                variante="primaire"
                question={t(
                  "Clôturer définitivement la mission ? Elle ne pourra plus être modifiée.",
                  "Permanently close the engagement? It can no longer be modified.",
                )}
                libelleConfirmation={t("Oui, clôturer", "Yes, close")}
                texteChargement={t("Clôture…", "Closing…")}
                action={() =>
                  f.envoyer({ ok: true, charge: null }, () => api.post(`${chemin}/cloturer`), {
                    succes: t("Mission clôturée.", "Engagement closed."),
                    apres: marquerAttente,
                  })
                }
              />
            ) : null}
          </div>
        ) : null}

        {droits.signer ? (
          mission.directeurDesigne ? (
            <Signature
              missionId={mission.id}
              devise={mission.devise}
              natures={natures}
              peutSaisirTaux={peutSaisirTaux}
              onSignee={() => setSignee(true)}
            />
          ) : (
            <Alerte
              tonalite="attention"
              titre={t("Signature impossible pour l'instant", "Signing not possible yet")}
              annonce="aucune"
            >
              <p>
                {t(
                  "Désignez d'abord le directeur de mission (bouton « Modifier » de la fiche).",
                  "First assign the engagement director (\u201cEdit\u201d button on the overview).",
                )}
              </p>
            </Alerte>
          )
        ) : null}

        {droits.dupliquer || droits.enregistrerModele ? (
          <div className="mp-barre-actions">
            {droits.dupliquer ? (
              <Bouton
                variante="secondaire"
                icone="copie"
                aria-expanded={panneau === "duplication"}
                onClick={() => setPanneau((p) => (p === "duplication" ? "aucun" : "duplication"))}
              >
                {t("Dupliquer", "Duplicate")}
              </Bouton>
            ) : null}
            {droits.enregistrerModele ? (
              <Bouton
                variante="secondaire"
                icone="livre"
                aria-expanded={panneau === "modele"}
                onClick={() => setPanneau((p) => (p === "modele" ? "aucun" : "modele"))}
              >
                {t("Enregistrer comme modèle", "Save as template")}
              </Bouton>
            ) : null}
          </div>
        ) : null}
        {panneau === "duplication" ? (
          <Duplication
            missionId={mission.id}
            intitule={mission.intitule}
            clients={clients}
            onFin={() => setPanneau("aucun")}
          />
        ) : null}
        {panneau === "modele" ? (
          <Modele
            missionId={mission.id}
            intitule={mission.intitule}
            onFin={() => setPanneau("aucun")}
          />
        ) : null}
      </div>
    </Carte>
  );
}
