"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { formaterDateHeure } from "../../lib/format";
import {
  MOTIF_COTATION_LONGUEUR_MAX,
  cheminCotations,
  compteurCaracteres,
  messageNotationAugmentee,
  niveauxEchelle,
  validerCotation,
  type CotationVisibleCalibration,
  type MaCotationCalibration,
  type SessionCalibration,
} from "../../lib/notation-augmentee";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface CotationCasProps {
  sessionId: string;
  cas: { code: string; libelle: string };
  niveaux: number;
  /** Nombre d'évaluateurs ayant coté ce cas (avancement, jamais leurs niveaux). */
  evaluateurs: number;
  maCotation: MaCotationCalibration | null;
  /** Cotations visibles de ce cas (celles des autres seulement si l'API les montre). */
  visibles: CotationVisibleCalibration[];
  utilisateurId: string;
  /** Session ouverte et droit de coter. */
  peutCoter: boolean;
  close: boolean;
}

/**
 * Un cas d'une session : ma cotation (niveau et motif, une seule par cas et définitive), le nombre
 * d'évaluateurs, et les cotations des autres UNIQUEMENT si l'API les renvoie (règle de la double
 * cotation à l'aveugle appliquée par l'API : rien n'est déduit ni masqué ici).
 */
export function CotationCas({
  sessionId,
  cas,
  niveaux,
  evaluateurs,
  maCotation,
  visibles,
  utilisateurId,
  peutCoter,
  close,
}: CotationCasProps) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"niveau" | "motif">();
  const [niveau, setNiveau] = useState("");
  const [motif, setMotif] = useState("");

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerCotation(cas.code, niveau, motif, niveaux, langue),
      (charge) => api.post<SessionCalibration>(cheminCotations(sessionId), charge),
      {
        succes: t("Cotation enregistrée.", "Rating saved."),
        messageSpecifique: (err) => messageNotationAugmentee(err, langue),
      },
    );
  }

  return (
    <li>
      <div className="mp-na-cas__entete">
        <span className="mp-na-liste__titre">{cas.libelle}</span>
        <span className="mp-na-cas__code">{cas.code}</span>
        <span className="mp-texte-doux mp-texte-petit">
          {evaluateurs === 0
            ? t("Aucun évaluateur n'a encore coté ce cas.", "No rater has rated this case yet.")
            : t(
                `${evaluateurs} évaluateur${evaluateurs > 1 ? "s ont" : " a"} coté ce cas.`,
                `${evaluateurs} rater${evaluateurs > 1 ? "s have" : " has"} rated this case.`,
              )}
        </span>
      </div>

      {maCotation ? (
        <p>
          <strong>
            {t("Ma cotation : niveau", "My rating: level")} {maCotation.niveau}
          </strong>
          {maCotation.motif ? ` — ${maCotation.motif}` : ""}{" "}
          <span className="mp-texte-doux mp-texte-petit">
            ({t("le", "on")} {formaterDateHeure(maCotation.cree_le, "Africa/Abidjan", langue)},{" "}
            {t("définitive", "final")})
          </span>
        </p>
      ) : peutCoter ? (
        <form
          ref={f.refFormulaire}
          className="mp-na-cas__formulaire"
          noValidate
          onSubmit={soumettre}
          aria-label={t(`Coter le cas « ${cas.libelle} »`, `Rate the case "${cas.libelle}"`)}
        >
          <RetourFormulaire
            erreur={f.erreurGlobale}
            succes={f.succes}
            refAlerte={f.refAlerte}
            titreErreur={t("Cotation impossible", "Rating failed")}
          />
          <Select
            libelle={t("Mon niveau", "My level")}
            required
            invite={t("Choisir un niveau…", "Choose a level…")}
            value={niveau}
            onChange={(e) => setNiveau(e.target.value)}
            erreur={f.erreurs.niveau}
            options={niveauxEchelle(niveaux).map((n) => ({
              valeur: String(n),
              libelle: t(`Niveau ${n} sur ${niveaux}`, `Level ${n} of ${niveaux}`),
            }))}
          />
          <ZoneTexte
            libelle={t("Motif de ma cotation (facultatif)", "Reason for my rating (optional)")}
            rows={2}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            erreur={f.erreurs.motif}
            maxLength={MOTIF_COTATION_LONGUEUR_MAX + 200}
            aide={compteurCaracteres(motif, MOTIF_COTATION_LONGUEUR_MAX, langue)}
          />
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              chargement={f.enCours}
              texteChargement={t("Enregistrement…", "Saving…")}
            >
              {t("Enregistrer ma cotation", "Save my rating")}
            </Bouton>
            <span className="mp-texte-doux mp-texte-petit">
              {t(
                "Une cotation ne se modifie pas : relisez avant d'enregistrer.",
                "A rating cannot be changed: review before saving.",
              )}
            </span>
          </div>
        </form>
      ) : close ? (
        <p className="mp-texte-doux">
          {t("Vous n'avez pas coté ce cas.", "You did not rate this case.")}
        </p>
      ) : (
        <p className="mp-texte-doux">
          {t(
            "Votre rôle ne permet pas de coter dans cette session.",
            "Your role does not allow rating in this session.",
          )}
        </p>
      )}

      {visibles.length > 0 ? (
        <div className="mp-pile">
          <p className="mp-na-liste__titre">{t("Cotations visibles", "Visible ratings")}</p>
          <ul className="mp-na-cotations">
            {visibles.map((c, i) => (
              <li key={`${c.evaluateur.id}-${i}`}>
                {c.evaluateur.id === utilisateurId ? t("Vous", "You") : c.evaluateur.nom} :{" "}
                {t("niveau", "level")} {c.niveau}
                {c.motif ? ` — ${c.motif}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}
