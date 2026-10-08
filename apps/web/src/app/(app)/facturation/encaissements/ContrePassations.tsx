"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { Role } from "@missionpilot/shared";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { api } from "../../../../lib/api";
import {
  messageEncaissement,
  peutDeciderContrePassation,
  validerMotifContrePassation,
  type ContrePassation,
} from "../../../../lib/encaissements";
import { formaterDateHeure } from "../../../../lib/format";

/**
 * Demandes de contre-passation à décider. Le demandeur ne voit jamais de bouton de décision
 * sur sa propre demande (sauf associé) : séparation des tâches, l'API la fait respecter.
 */
export function ContrePassationsEnAttente({
  demandes,
  utilisateurId,
  roles,
}: {
  demandes: readonly ContrePassation[];
  utilisateurId: string;
  roles: readonly Role[];
}) {
  return (
    <Carte titre={`Contre-passations à valider (${demandes.length})`}>
      <ul className="mp-liste-lignes">
        {demandes.map((d) => (
          <li key={d.id} className="mp-liste-lignes__ligne mp-contre-passation">
            <DemandeContrePassation
              demande={d}
              deMoi={d.demandee_par === utilisateurId}
              peutDecider={peutDeciderContrePassation(d, utilisateurId, roles)}
            />
          </li>
        ))}
      </ul>
    </Carte>
  );
}

export function DemandeContrePassation({
  demande: d,
  deMoi,
  peutDecider,
}: {
  demande: ContrePassation;
  deMoi: boolean;
  peutDecider: boolean;
}) {
  const [rejet, setRejet] = useState(false);
  const op = useFormulaire<"motif">();
  const [attente, marquer] = useAttenteRafraichissement(d.statut);
  const chemin = `/api/finance/contre-passations/${encodeURIComponent(d.id)}`;
  return (
    <div className="mp-pile">
      <div className="mp-contre-passation__texte">
        <p>
          <BadgeStatut tonalite="attention">À valider</BadgeStatut>{" "}
          <Link href={`/facturation/encaissements/${d.encaissement_id}`}>
            Voir l&apos;encaissement
          </Link>
        </p>
        <p>{`Motif : ${d.motif}`}</p>
        <p className="mp-texte-doux mp-texte-petit">
          {`Demandée ${deMoi ? "par vous" : "par une autre personne"} le ${formaterDateHeure(d.demandee_le)}`}
        </p>
      </div>
      <RetourFormulaire
        erreur={op.erreurGlobale}
        succes={op.succes}
        refAlerte={op.refAlerte}
        titreErreur="Décision impossible"
      />
      {peutDecider ? (
        <div className="mp-barre-actions">
          <BoutonConfirmation
            libelle={attente ? "Mise à jour…" : "Valider la contre-passation"}
            variante="primaire"
            icone="succes"
            question="Valider ? Un encaissement négatif est créé et les factures imputées redeviennent dues. C'est définitif."
            libelleConfirmation="Oui, valider"
            texteChargement="Validation…"
            action={() =>
              op.envoyer({ ok: true, charge: null }, () => api.post(`${chemin}/valider`), {
                succes: "Contre-passation validée.",
                messageSpecifique: messageEncaissement,
                apres: marquer,
              })
            }
          />
          <Bouton variante="secondaire" aria-expanded={rejet} onClick={() => setRejet(!rejet)}>
            Rejeter
          </Bouton>
        </div>
      ) : (
        <p className="mp-texte-doux">
          {deMoi
            ? "Votre demande attend la validation d'un autre gestionnaire ou d'un associé."
            : "En attente de décision."}
        </p>
      )}
      {peutDecider && rejet ? (
        <FormulaireRejet chemin={chemin} onFin={() => setRejet(false)} apres={marquer} />
      ) : null}
    </div>
  );
}

function FormulaireRejet({
  chemin,
  onFin,
  apres,
}: {
  chemin: string;
  onFin: () => void;
  apres: () => void;
}) {
  const [motif, setMotif] = useState("");
  const form = useFormulaire<"motif">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await form.envoyer(
      validerMotifContrePassation(motif),
      (c) => api.post(`${chemin}/rejeter`, c),
      {
        succes: "Demande rejetée.",
        messageSpecifique: messageEncaissement,
        apres,
      },
    );
  }
  return (
    <form
      ref={form.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Rejeter la contre-passation"
    >
      <RetourFormulaire erreur={form.erreurGlobale} refAlerte={form.refAlerte} />
      <ZoneTexte
        libelle="Motif du rejet"
        required
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={form.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="danger" chargement={form.enCours} texteChargement="Rejet…">
          Rejeter la demande
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
