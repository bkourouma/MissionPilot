"use client";

import Link from "next/link";
import { useRafraichir } from "../../../../../components/formulaires/useRafraichir";
import { useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
import { BoutonConfirmation } from "../../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { ZoneTexte } from "../../../../../components/ui/ZoneTexte";
import { api } from "../../../../../lib/api";
import {
  HREF_PARAMETRAGE_CLOTURE,
  libelleControle,
  messageClotureBloquee,
  validerAttestation,
  validerMotifDerogation,
  type DroitsCloture,
  type ItemCloture,
} from "../../../../../lib/cloture";

/** Dérogation motivée (accorder, retirer) et attestation d'un item de la check-list. */
export function ActionsItemCloture({
  missionId,
  item,
  droits,
}: {
  missionId: string;
  item: ItemCloture;
  droits: DroitsCloture;
}) {
  const t = useT();
  const langue = useLangue();
  const base = `/api/missions/${encodeURIComponent(missionId)}/cloture`;
  const f = useFormulaire<"motif" | "note">();
  const [panneau, setPanneau] = useState<"aucun" | "derogation" | "retrait" | "attestation">(
    "aucun",
  );
  const [texte, setTexte] = useState("");
  const nom = libelleControle(item.controle, langue);

  const peutAccorder = droits.deroger && item.etat === "bloque";
  const peutRetirer = droits.deroger && item.etat === "deroge";
  const peutAttester = droits.evaluer && item.par_attestation && item.actif;
  if (!peutAccorder && !peutRetirer && !peutAttester) return null;

  function fermer() {
    setPanneau("aucun");
    setTexte("");
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (panneau === "derogation") {
      await f.envoyer(
        validerMotifDerogation(texte, langue),
        (c) => api.post(`${base}/derogations`, { controle: item.controle, ...c }),
        {
          succes: t(`Dérogation accordée pour « ${nom} ».`, `Waiver granted for "${nom}".`),
          apres: fermer,
        },
      );
    } else if (panneau === "retrait") {
      await f.envoyer(
        validerMotifDerogation(texte, langue),
        (c) => api.post(`${base}/derogations/${item.controle}/retrait`, c),
        {
          succes: t(`Dérogation retirée pour « ${nom} ».`, `Waiver withdrawn for "${nom}".`),
          apres: fermer,
        },
      );
    } else if (panneau === "attestation") {
      await f.envoyer(
        validerAttestation(texte, langue),
        (c) => api.post(`${base}/attestations`, c),
        {
          succes: t(`« ${nom} » attestée.`, `"${nom}" attested.`),
          apres: fermer,
        },
      );
    }
  }

  const titrePanneau =
    panneau === "derogation"
      ? t("Motif de la dérogation", "Reason for the waiver")
      : panneau === "retrait"
        ? t("Motif du retrait", "Reason for the withdrawal")
        : t("Note d'attestation (facultative)", "Attestation note (optional)");

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Action impossible", "Action failed")}
      />
      {panneau === "aucun" ? (
        <div className="mp-barre-actions">
          {peutAccorder ? (
            <Bouton
              variante="secondaire"
              aria-label={t(`Déroger : ${nom}`, `Waive: ${nom}`)}
              onClick={() => setPanneau("derogation")}
            >
              {t("Déroger…", "Waive…")}
            </Bouton>
          ) : null}
          {peutRetirer ? (
            <Bouton
              variante="secondaire"
              aria-label={t(`Retirer la dérogation : ${nom}`, `Withdraw the waiver: ${nom}`)}
              onClick={() => setPanneau("retrait")}
            >
              {t("Retirer la dérogation…", "Withdraw the waiver…")}
            </Bouton>
          ) : null}
          {peutAttester && item.attestation?.attestee ? (
            <Bouton
              variante="discret"
              chargement={f.enCours}
              texteChargement={t("Retrait…", "Withdrawing…")}
              aria-label={t(`Retirer l'attestation : ${nom}`, `Withdraw the attestation: ${nom}`)}
              onClick={() => {
                void f.envoyer(
                  { ok: true, charge: { controle: item.controle, attestee: false } },
                  (c) => api.post(`${base}/attestations`, c),
                  {
                    succes: t(
                      `Attestation retirée pour « ${nom} ».`,
                      `Attestation withdrawn for "${nom}".`,
                    ),
                  },
                );
              }}
            >
              {t("Retirer l'attestation", "Withdraw the attestation")}
            </Bouton>
          ) : null}
          {peutAttester && !item.attestation?.attestee ? (
            <Bouton
              variante="secondaire"
              aria-label={t(`Attester : ${nom}`, `Attest: ${nom}`)}
              onClick={() => setPanneau("attestation")}
            >
              {t("Attester…", "Attest…")}
            </Bouton>
          ) : null}
        </div>
      ) : (
        <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
          <ZoneTexte
            libelle={titrePanneau}
            required={panneau !== "attestation"}
            maxLength={500}
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            erreur={f.erreurs.motif ?? f.erreurs.note}
            aide={
              panneau === "attestation"
                ? t(
                    "Déclaré par vous, daté et conservé dans l'historique de la mission.",
                    "Declared by you, dated and kept in the engagement history.",
                  )
                : t(
                    "Au moins 10 caractères. Le motif est conservé dans l'historique de la mission.",
                    "At least 10 characters. The reason is kept in the engagement history.",
                  )
            }
          />
          <div className="mp-barre-actions">
            <Bouton
              type="submit"
              chargement={f.enCours}
              texteChargement={t("Enregistrement…", "Saving…")}
            >
              {t("Enregistrer", "Save")}
            </Bouton>
            <Bouton variante="secondaire" disabled={f.enCours} onClick={fermer}>
              {t("Annuler", "Cancel")}
            </Bouton>
          </div>
        </form>
      )}
    </div>
  );
}

/** Réévaluation avec enregistrement et clôture de la mission (activée seulement si tout est vert). */
export function BarreCloture({
  missionId,
  droits,
  activable,
  raison,
}: {
  missionId: string;
  droits: DroitsCloture;
  activable: boolean;
  raison: string | null;
}) {
  const t = useT();
  const { rafraichir } = useRafraichir();
  const f = useFormulaire<never>();
  const base = `/api/missions/${encodeURIComponent(missionId)}`;
  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Clôture impossible", "Close-out failed")}
      />
      <div className="mp-barre-actions">
        {droits.evaluer ? (
          <Bouton
            variante="secondaire"
            chargement={f.enCours}
            texteChargement={t("Vérification…", "Verifying…")}
            onClick={() => {
              void f.envoyer(
                { ok: true, charge: null },
                () => api.post(`${base}/cloture/evaluer`),
                {
                  succes: t("Check-list vérifiée et enregistrée.", "Checklist verified and saved."),
                },
              );
            }}
          >
            {t("Revérifier et enregistrer", "Re-verify and save")}
          </Bouton>
        ) : null}
        {droits.cloturer && activable ? (
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
              f.envoyer({ ok: true, charge: null }, () => api.post(`${base}/cloturer`), {
                succes: t("Mission clôturée.", "Engagement closed."),
                messageSpecifique: messageClotureBloquee,
                apres: () => rafraichir(),
              })
            }
          />
        ) : droits.cloturer ? (
          <Bouton disabled icone="cadenas" aria-describedby="raison-cloture">
            {t("Clôturer la mission", "Close the engagement")}
          </Bouton>
        ) : null}
        {droits.parametrer ? (
          <Link className="mp-pagination__lien" href={HREF_PARAMETRAGE_CLOTURE}>
            {t("Paramétrer le modèle", "Configure the template")}
          </Link>
        ) : null}
      </div>
      {raison && droits.cloturer ? (
        <p id="raison-cloture" className="mp-texte-doux">
          {raison}
        </p>
      ) : null}
    </div>
  );
}
