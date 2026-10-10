"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
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
  const base = `/api/missions/${encodeURIComponent(missionId)}/cloture`;
  const f = useFormulaire<"motif" | "note">();
  const [panneau, setPanneau] = useState<"aucun" | "derogation" | "retrait" | "attestation">(
    "aucun",
  );
  const [texte, setTexte] = useState("");
  const nom = libelleControle(item.controle);

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
        validerMotifDerogation(texte),
        (c) => api.post(`${base}/derogations`, { controle: item.controle, ...c }),
        { succes: `Dérogation accordée pour « ${nom} ».`, apres: fermer },
      );
    } else if (panneau === "retrait") {
      await f.envoyer(
        validerMotifDerogation(texte),
        (c) => api.post(`${base}/derogations/${item.controle}/retrait`, c),
        { succes: `Dérogation retirée pour « ${nom} ».`, apres: fermer },
      );
    } else if (panneau === "attestation") {
      await f.envoyer(validerAttestation(texte), (c) => api.post(`${base}/attestations`, c), {
        succes: `« ${nom} » attestée.`,
        apres: fermer,
      });
    }
  }

  const titrePanneau =
    panneau === "derogation"
      ? "Motif de la dérogation"
      : panneau === "retrait"
        ? "Motif du retrait"
        : "Note d'attestation (facultative)";

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Action impossible"
      />
      {panneau === "aucun" ? (
        <div className="mp-barre-actions">
          {peutAccorder ? (
            <Bouton
              variante="secondaire"
              aria-label={`Déroger : ${nom}`}
              onClick={() => setPanneau("derogation")}
            >
              Déroger…
            </Bouton>
          ) : null}
          {peutRetirer ? (
            <Bouton
              variante="secondaire"
              aria-label={`Retirer la dérogation : ${nom}`}
              onClick={() => setPanneau("retrait")}
            >
              Retirer la dérogation…
            </Bouton>
          ) : null}
          {peutAttester && item.attestation?.attestee ? (
            <Bouton
              variante="discret"
              aria-label={`Retirer l'attestation : ${nom}`}
              onClick={() => {
                void f.envoyer(
                  { ok: true, charge: { controle: item.controle, attestee: false } },
                  (c) => api.post(`${base}/attestations`, c),
                  { succes: `Attestation retirée pour « ${nom} ».` },
                );
              }}
            >
              Retirer l&apos;attestation
            </Bouton>
          ) : null}
          {peutAttester && !item.attestation?.attestee ? (
            <Bouton
              variante="secondaire"
              aria-label={`Attester : ${nom}`}
              onClick={() => setPanneau("attestation")}
            >
              Attester…
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
                ? "Déclaré par vous, daté et conservé dans l'historique de la mission."
                : "Au moins 10 caractères. Le motif est conservé dans l'historique de la mission."
            }
          />
          <div className="mp-barre-actions">
            <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
              Enregistrer
            </Bouton>
            <Bouton variante="secondaire" disabled={f.enCours} onClick={fermer}>
              Annuler
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
  const router = useRouter();
  const f = useFormulaire<never>();
  const base = `/api/missions/${encodeURIComponent(missionId)}`;
  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Clôture impossible"
      />
      <div className="mp-barre-actions">
        {droits.evaluer ? (
          <Bouton
            variante="secondaire"
            chargement={f.enCours}
            texteChargement="Vérification…"
            onClick={() => {
              void f.envoyer(
                { ok: true, charge: null },
                () => api.post(`${base}/cloture/evaluer`),
                { succes: "Check-list vérifiée et enregistrée." },
              );
            }}
          >
            Revérifier et enregistrer
          </Bouton>
        ) : null}
        {droits.cloturer && activable ? (
          <BoutonConfirmation
            libelle="Clôturer la mission"
            icone="cadenas"
            variante="primaire"
            question="Clôturer définitivement la mission ? Elle ne pourra plus être modifiée."
            libelleConfirmation="Oui, clôturer"
            texteChargement="Clôture…"
            action={() =>
              f.envoyer({ ok: true, charge: null }, () => api.post(`${base}/cloturer`), {
                succes: "Mission clôturée.",
                messageSpecifique: messageClotureBloquee,
                apres: () => router.refresh(),
              })
            }
          />
        ) : droits.cloturer ? (
          <Bouton disabled icone="cadenas" aria-describedby="raison-cloture">
            Clôturer la mission
          </Bouton>
        ) : null}
        {droits.parametrer ? (
          <Link className="mp-pagination__lien" href={HREF_PARAMETRAGE_CLOTURE}>
            Paramétrer le modèle
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
