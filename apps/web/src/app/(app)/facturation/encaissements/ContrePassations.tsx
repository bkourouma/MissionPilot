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
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
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
  const t = useT();
  return (
    <Carte
      titre={t(
        `Contre-passations à valider (${demandes.length})`,
        `Reversals pending approval (${demandes.length})`,
      )}
    >
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
  const t = useT();
  const langue = useLangue();
  const [rejet, setRejet] = useState(false);
  const op = useFormulaire<"motif">();
  const [attente, marquer] = useAttenteRafraichissement(d.statut);
  const chemin = `/api/finance/contre-passations/${encodeURIComponent(d.id)}`;
  return (
    <div className="mp-pile">
      <div className="mp-contre-passation__texte">
        <p>
          <BadgeStatut tonalite="attention">{t("À valider", "Pending approval")}</BadgeStatut>{" "}
          <Link href={`/facturation/encaissements/${d.encaissement_id}`}>
            {t("Voir l'encaissement", "View the payment")}
          </Link>
        </p>
        <p>{t(`Motif : ${d.motif}`, `Reason: ${d.motif}`)}</p>
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            `Demandée ${deMoi ? "par vous" : "par une autre personne"} le ${formaterDateHeure(d.demandee_le)}`,
            `Requested ${deMoi ? "by you" : "by someone else"} on ${formaterDateHeure(d.demandee_le, undefined, langue)}`,
          )}
        </p>
      </div>
      <RetourFormulaire
        erreur={op.erreurGlobale}
        succes={op.succes}
        refAlerte={op.refAlerte}
        titreErreur={t("Décision impossible", "Decision not possible")}
      />
      {peutDecider ? (
        <div className="mp-barre-actions">
          <BoutonConfirmation
            libelle={
              attente
                ? t("Mise à jour…", "Updating…")
                : t("Valider la contre-passation", "Approve the reversal")
            }
            variante="primaire"
            icone="succes"
            question={t(
              "Valider ? Un encaissement négatif est créé et les factures imputées redeviennent dues. C'est définitif.",
              "Approve? A negative payment is created and the allocated invoices become due again. This is final.",
            )}
            libelleConfirmation={t("Oui, valider", "Yes, approve")}
            texteChargement={t("Validation…", "Approving…")}
            action={() =>
              op.envoyer({ ok: true, charge: null }, () => api.post(`${chemin}/valider`), {
                succes: t("Contre-passation validée.", "Reversal approved."),
                messageSpecifique: (e) => messageEncaissement(e, langue),
                apres: marquer,
              })
            }
          />
          <Bouton variante="secondaire" aria-expanded={rejet} onClick={() => setRejet(!rejet)}>
            {t("Rejeter", "Reject")}
          </Bouton>
        </div>
      ) : (
        <p className="mp-texte-doux">
          {deMoi
            ? t(
                "Votre demande attend la validation d'un autre gestionnaire ou d'un associé.",
                "Your request is awaiting approval from another manager or a partner.",
              )
            : t("En attente de décision.", "Awaiting a decision.")}
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
  const t = useT();
  const langue = useLangue();
  const [motif, setMotif] = useState("");
  const form = useFormulaire<"motif">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await form.envoyer(
      validerMotifContrePassation(motif, langue),
      (c) => api.post(`${chemin}/rejeter`, c),
      {
        succes: t("Demande rejetée.", "Request rejected."),
        messageSpecifique: (e) => messageEncaissement(e, langue),
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
      aria-label={t("Rejeter la contre-passation", "Reject the reversal")}
    >
      <RetourFormulaire erreur={form.erreurGlobale} refAlerte={form.refAlerte} />
      <ZoneTexte
        libelle={t("Motif du rejet", "Reason for rejection")}
        required
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={form.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="danger"
          chargement={form.enCours}
          texteChargement={t("Rejet…", "Rejecting…")}
        >
          {t("Rejeter la demande", "Reject the request")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
