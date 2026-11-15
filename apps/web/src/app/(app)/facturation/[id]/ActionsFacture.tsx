"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../components/formulaires/useAttenteRafraichissement";
import { useFermetureDifferee } from "../../../../components/formulaires/useFermetureDifferee";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Carte } from "../../../../components/ui/Carte";
import { Champ } from "../../../../components/ui/Champ";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { api } from "../../../../lib/api";
import {
  messageFacture,
  validerEnTete,
  validerMotif,
  type ActionsFacture as Actions,
  type ChampEnTete,
  type FactureDetaillee,
  type SaisieEnTete,
} from "../../../../lib/factures";
import { montantVersSaisie } from "../../../../lib/saisie";
import { ChampsRemise } from "./ContenuFacture";

type Panneau = "entete" | "rejet" | "avoir" | null;

/** Circuit de la facture : actions permises par le rôle et le statut (l'API reste seule juge). */
export function ActionsFacture({
  facture: f,
  actions: a,
}: {
  facture: FactureDetaillee;
  actions: Actions;
}) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const messageSpecifique = (e: unknown) => messageFacture(e, langue);
  const cle = `${f.statut}-${f.modifie_le}-${f.envoyee_le}`;
  const [panneau, setPanneau, fermerApresRafraichissement] =
    useFermetureDifferee<Exclude<Panneau, null>>(cle);
  const op = useFormulaire<never>();
  const [attente, marquer] = useAttenteRafraichissement(
    `${f.statut}-${f.modifie_le}-${f.envoyee_le}`,
  );
  const chemin = `/api/factures/${encodeURIComponent(f.id)}`;
  const occupe = op.enCours || attente;
  const poster = (suffixe: string, succes: string) =>
    op.envoyer({ ok: true, charge: null }, () => api.post(`${chemin}/${suffixe}`), {
      succes,
      apres: marquer,
      messageSpecifique,
    });
  const aucune = !Object.entries(a).some(([k, v]) => k !== "raisonRefusApprobation" && v === true);
  if (aucune) return null;

  return (
    <Carte titre={t("Actions", "Actions")}>
      <div className="mp-pile">
        <RetourFormulaire
          erreur={op.erreurGlobale}
          succes={op.succes}
          refAlerte={op.refAlerte}
          titreErreur={t("Action impossible", "Action not possible")}
        />
        <div className="mp-barre-actions">
          {a.modifier ? (
            <Bouton
              variante="secondaire"
              icone="crayon"
              aria-expanded={panneau === "entete"}
              onClick={() => setPanneau(panneau === "entete" ? null : "entete")}
            >
              {t(
                "Objet, remise, retenue et délai",
                "Subject, discount, withholding and payment terms",
              )}
            </Bouton>
          ) : null}
          {a.soumettre ? (
            <Bouton
              icone="envoyer"
              chargement={occupe}
              texteChargement={t("Soumission…", "Submitting…")}
              onClick={() =>
                poster(
                  "soumettre",
                  t("Facture soumise à approbation.", "Invoice submitted for approval."),
                )
              }
            >
              {t("Soumettre à approbation", "Submit for approval")}
            </Bouton>
          ) : null}
          {a.approuver ? (
            <Bouton
              icone="succes"
              chargement={occupe}
              texteChargement={t("Approbation…", "Approving…")}
              onClick={() => poster("approuver", t("Facture approuvée.", "Invoice approved."))}
            >
              {t("Approuver", "Approve")}
            </Bouton>
          ) : null}
          {a.rejeter ? (
            <Bouton
              variante="secondaire"
              aria-expanded={panneau === "rejet"}
              onClick={() => setPanneau(panneau === "rejet" ? null : "rejet")}
            >
              {t("Rejeter", "Reject")}
            </Bouton>
          ) : null}
          {a.emettre ? (
            <BoutonConfirmation
              libelle={t("Émettre la facture", "Issue the invoice")}
              variante="primaire"
              icone="signature"
              question={t(
                "Émettre cette facture ? Elle reçoit son numéro définitif et ne pourra plus être modifiée : seule une annulation par avoir sera possible.",
                "Issue this invoice? It receives its final number and can no longer be edited: only a cancellation by credit note will be possible.",
              )}
              libelleConfirmation={t("Oui, émettre", "Yes, issue")}
              texteChargement={t("Émission…", "Issuing…")}
              action={() =>
                poster(
                  "emettre",
                  t(
                    "Facture émise : numéro définitif attribué.",
                    "Invoice issued: final number assigned.",
                  ),
                )
              }
            />
          ) : null}
          {a.marquerEnvoyee ? (
            <BoutonConfirmation
              libelle={t("Marquer comme envoyée", "Mark as sent")}
              icone="courrier"
              question={t(
                "Confirmer que la facture a été envoyée au client ? Cette mention ne s'annule pas.",
                "Confirm that the invoice was sent to the client? This mark cannot be undone.",
              )}
              libelleConfirmation={t("Oui, marquer envoyée", "Yes, mark as sent")}
              texteChargement={t("Enregistrement…", "Saving…")}
              action={() =>
                poster(
                  "marquer-envoyee",
                  t("Facture marquée comme envoyée.", "Invoice marked as sent."),
                )
              }
            />
          ) : null}
          {a.avoir ? (
            <Bouton
              variante="secondaire"
              aria-expanded={panneau === "avoir"}
              onClick={() => setPanneau(panneau === "avoir" ? null : "avoir")}
            >
              {t("Annuler par un avoir", "Cancel by credit note")}
            </Bouton>
          ) : null}
          {a.supprimer ? (
            <BoutonConfirmation
              libelle={t("Supprimer le brouillon", "Delete the draft")}
              variante="discret"
              icone="corbeille"
              question={t(
                "Supprimer ce brouillon ? Ses échéances et débours redeviennent facturables.",
                "Delete this draft? Its due dates and expenses become invoiceable again.",
              )}
              libelleConfirmation={t("Oui, supprimer", "Yes, delete")}
              texteChargement={t("Suppression…", "Deleting…")}
              action={() =>
                op.envoyer({ ok: true, charge: null }, () => api.supprimer(chemin), {
                  rafraichir: false,
                  apres: () => router.push("/facturation"),
                  messageSpecifique,
                })
              }
            />
          ) : null}
        </div>
        {panneau === "entete" ? (
          <FormulaireEnTete
            facture={f}
            onFin={() => setPanneau(null)}
            onEnregistre={fermerApresRafraichissement}
          />
        ) : null}
        {panneau === "rejet" ? (
          <FormulaireMotif
            titre={t("Rejeter la facture", "Reject the invoice")}
            aide={t(
              "La facture revient en brouillon ; le motif est affiché à son auteur.",
              "The invoice goes back to draft; the reason is shown to its author.",
            )}
            bouton={t("Rejeter la facture", "Reject the invoice")}
            appel={(c) => api.post(`${chemin}/rejeter`, c)}
            onFin={() => setPanneau(null)}
            onEnregistre={fermerApresRafraichissement}
          />
        ) : null}
        {panneau === "avoir" ? (
          <FormulaireMotif
            titre={t("Annuler par un avoir total", "Cancel by full credit note")}
            aide={t(
              "Un avoir en brouillon reprend toute la facture. À son émission, la facture est annulée et ses échéances et débours redeviennent facturables.",
              "A draft credit note covers the whole invoice. When it is issued, the invoice is cancelled and its due dates and expenses become invoiceable again.",
            )}
            bouton={t("Créer l'avoir (brouillon)", "Create the credit note (draft)")}
            appel={(c) => api.post<{ id: string }>(`${chemin}/avoir`, c)}
            onFin={() => setPanneau(null)}
            onEnregistre={fermerApresRafraichissement}
            apres={(r) => router.push(`/facturation/${(r as { id: string }).id}`)}
          />
        ) : null}
      </div>
    </Carte>
  );
}

function FormulaireEnTete({
  facture: f,
  onFin,
  onEnregistre,
}: {
  facture: FactureDetaillee;
  onFin: () => void;
  onEnregistre: () => void;
}) {
  const [s, setS] = useState<SaisieEnTete>({
    objet: f.objet ?? "",
    remise: {
      type: f.remise_globale_type ?? "",
      valeur:
        f.remise_globale_valeur === null
          ? ""
          : f.remise_globale_type === "montant"
            ? montantVersSaisie(f.remise_globale_valeur, f.devise)
            : String(f.remise_globale_valeur).replace(".", ","),
    },
    retenue_active: f.retenue_active,
    delai_paiement_jours: String(f.delai_paiement_jours),
  });
  const t = useT();
  const langue = useLangue();
  const form = useFormulaire<ChampEnTete>();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await form.envoyer(
      validerEnTete(s, f.devise, langue),
      (c) => api.patch(`/api/factures/${encodeURIComponent(f.id)}`, c),
      {
        apres: onEnregistre,
        messageSpecifique: (e) => messageFacture(e, langue),
      },
    );
  }
  return (
    <form
      ref={form.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t(
        "Objet, remise, retenue et délai",
        "Subject, discount, withholding and payment terms",
      )}
    >
      <RetourFormulaire erreur={form.erreurGlobale} refAlerte={form.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Objet", "Subject")}
          maxLength={300}
          value={s.objet}
          onChange={(e) => setS((x) => ({ ...x, objet: e.target.value }))}
          erreur={form.erreurs.objet}
        />
        <ChampsRemise
          libelle={t("Remise globale", "Overall discount")}
          saisie={s.remise}
          devise={f.devise}
          erreur={form.erreurs.remise}
          onChange={(remise) => setS((x) => ({ ...x, remise }))}
        />
        <Champ
          libelle={t("Délai de paiement (jours)", "Payment term (days)")}
          required
          inputMode="numeric"
          value={s.delai_paiement_jours}
          onChange={(e) => setS((x) => ({ ...x, delai_paiement_jours: e.target.value }))}
          erreur={form.erreurs.delai_paiement_jours}
        />
      </div>
      <CaseACocher
        libelle={t(
          `Appliquer la retenue (${f.retenue_libelle})`,
          `Apply the withholding (${f.retenue_libelle})`,
        )}
        checked={s.retenue_active}
        onChange={(e) => setS((x) => ({ ...x, retenue_active: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={form.enCours}
          texteChargement={t("Recalcul…", "Recalculating…")}
        >
          {t("Enregistrer et recalculer", "Save and recalculate")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

function FormulaireMotif({
  titre,
  aide,
  bouton,
  appel,
  onFin,
  onEnregistre,
  apres,
}: {
  titre: string;
  aide: string;
  bouton: string;
  appel: (c: { motif: string }) => Promise<unknown>;
  onFin: () => void;
  onEnregistre: () => void;
  apres?: (r: unknown) => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [motif, setMotif] = useState("");
  const form = useFormulaire<"motif">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await form.envoyer(validerMotif(motif, langue), appel, {
      rafraichir: !apres,
      apres: apres ?? onEnregistre,
      messageSpecifique: (e) => messageFacture(e, langue),
    });
  }
  return (
    <form
      ref={form.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={titre}
    >
      <p className="mp-sous-formulaire__titre">{titre}</p>
      <RetourFormulaire erreur={form.erreurGlobale} refAlerte={form.refAlerte} />
      <ZoneTexte
        libelle={t("Motif", "Reason")}
        aide={aide}
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
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {bouton}
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
