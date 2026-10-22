"use client";

import { useState } from "react";
import type { StatutMission } from "@missionpilot/shared";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
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
    <Carte titre="Cycle de vie">
      <div className="mp-pile">
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur="Action impossible"
        />
        {signee ? (
          <Alerte tonalite="succes" titre="Lettre de mission signée">
            <p>Le budget initial est figé (version 1). Consultez-le dans l&apos;onglet Budget.</p>
          </Alerte>
        ) : null}
        {attente ? (
          <p className="mp-texte-doux" role="status">
            Mise à jour de la page…
          </p>
        ) : droits.transitions.length > 0 || droits.cloturer ? (
          <div className="mp-barre-actions">
            {droits.transitions.map((t) => (
              <Bouton
                key={t.cible}
                variante="secondaire"
                chargement={f.enCours}
                texteChargement="Mise à jour…"
                onClick={() =>
                  f.envoyer(
                    { ok: true, charge: { statut: t.cible } },
                    (c) => api.post(`${chemin}/statut`, c),
                    {
                      succes: "Statut mis à jour.",
                      apres: marquerAttente,
                    },
                  )
                }
              >
                {t.libelle}
              </Bouton>
            ))}
            {droits.cloturer ? (
              <BoutonConfirmation
                libelle="Clôturer la mission"
                icone="cadenas"
                variante="primaire"
                question="Clôturer définitivement la mission ? Elle ne pourra plus être modifiée."
                libelleConfirmation="Oui, clôturer"
                texteChargement="Clôture…"
                action={() =>
                  f.envoyer({ ok: true, charge: null }, () => api.post(`${chemin}/cloturer`), {
                    succes: "Mission clôturée.",
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
              titre="Signature impossible pour l'instant"
              annonce="aucune"
            >
              <p>
                Désignez d&apos;abord le directeur de mission (bouton « Modifier » de la fiche).
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
                Dupliquer
              </Bouton>
            ) : null}
            {droits.enregistrerModele ? (
              <Bouton
                variante="secondaire"
                icone="livre"
                aria-expanded={panneau === "modele"}
                onClick={() => setPanneau((p) => (p === "modele" ? "aucun" : "modele"))}
              >
                Enregistrer comme modèle
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
