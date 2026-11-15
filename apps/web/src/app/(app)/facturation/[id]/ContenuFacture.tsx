"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFermetureDifferee } from "../../../../components/formulaires/useFermetureDifferee";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import { Select } from "../../../../components/ui/Select";
import { Tableau } from "../../../../components/ui/Tableau";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { api } from "../../../../lib/api";
import type { Langue } from "@missionpilot/shared";
import {
  messageFacture,
  validerLigne,
  type ChampLigne,
  type FactureDetaillee,
  type LigneFacture,
  type SaisieLigne,
  type TypeRemise,
} from "../../../../lib/factures";
import {
  formaterMontantMineur,
  formaterNombre,
  type Devise,
  libelleDevise,
} from "../../../../lib/format";
import { montantVersSaisie } from "../../../../lib/saisie";

const NBSP = " ";
const pct = (n: number, langue: Langue) =>
  langue === "en" ? formaterNombre(n, 4, langue) + "%" : formaterNombre(n, 4) + NBSP + "%";

function libelleRemise(
  type: TypeRemise | null,
  valeur: number | null,
  devise: Devise,
  langue: Langue,
): string {
  if (type === null || valeur === null) return "—";
  return type === "pourcentage"
    ? pct(valeur, langue)
    : formaterMontantMineur(valeur, devise, langue);
}

/** Lignes de la facture ; montants fournis par l'API, modifiables en brouillon (libellé, TVA, remise). */
export function LignesFacture({
  facture: f,
  modifiable,
  tauxAutorises,
}: {
  facture: FactureDetaillee;
  modifiable: boolean;
  tauxAutorises: readonly number[];
}) {
  const [edition, setEdition, fermerApresRafraichissement] = useFermetureDifferee<string>(
    f.modifie_le,
  );
  const t = useT();
  const langue = useLangue();
  const m = (v: number) => formaterMontantMineur(v, f.devise, langue);
  const ligne = f.lignes.find((l) => l.id === edition);
  return (
    <div className="mp-pile">
      <Tableau
        legende={
          f.nature === "avoir"
            ? t("Lignes de l'avoir", "Credit note lines")
            : t("Lignes de la facture", "Invoice lines")
        }
        lignes={f.lignes}
        cleLigne={(l) => l.id}
        messageVide={t("Aucune ligne.", "No lines.")}
        colonnes={[
          { cle: "libelle", entete: t("Désignation", "Description"), rendu: (l) => l.libelle },
          {
            cle: "quantite",
            entete: t("Quantité", "Quantity"),
            alignement: "droite",
            rendu: (l) => formaterNombre(l.quantite, 4, langue),
          },
          {
            cle: "prix",
            entete: t("Prix unitaire HT", "Unit price excl. VAT"),
            alignement: "droite",
            rendu: (l) => m(l.prix_unitaire),
          },
          {
            cle: "remise",
            entete: t("Remise", "Discount"),
            alignement: "droite",
            rendu: (l) => libelleRemise(l.remise_type, l.remise_valeur, f.devise, langue),
          },
          {
            cle: "tva",
            entete: t("TVA", "VAT"),
            alignement: "droite",
            rendu: (l) => pct(l.taux_tva, langue),
          },
          {
            cle: "ht",
            entete: t("Montant HT", "Amount excl. VAT"),
            alignement: "droite",
            rendu: (l) => <span className="mp-montant">{m(l.montant_ht)}</span>,
          },
          ...(modifiable
            ? [
                {
                  cle: "actions",
                  entete: t("Actions", "Actions"),
                  rendu: (l: LigneFacture) => (
                    <Bouton
                      variante="discret"
                      icone="crayon"
                      onClick={() => setEdition(l.id)}
                      aria-label={t(`Modifier la ligne ${l.libelle}`, `Edit line ${l.libelle}`)}
                    >
                      {t("Modifier", "Edit")}
                    </Bouton>
                  ),
                },
              ]
            : []),
        ]}
      />
      {modifiable && ligne ? (
        <FormulaireLigne
          key={ligne.id}
          factureId={f.id}
          ligne={ligne}
          devise={f.devise}
          tauxAutorises={tauxAutorises}
          onFin={() => setEdition(null)}
          onEnregistre={fermerApresRafraichissement}
        />
      ) : null}
    </div>
  );
}

function FormulaireLigne({
  factureId,
  ligne,
  devise,
  tauxAutorises,
  onFin,
  onEnregistre,
}: {
  factureId: string;
  ligne: LigneFacture;
  devise: Devise;
  tauxAutorises: readonly number[];
  onFin: () => void;
  onEnregistre: () => void;
}) {
  const [s, setS] = useState<SaisieLigne>({
    libelle: ligne.libelle,
    taux_tva: String(ligne.taux_tva),
    remise: {
      type: ligne.remise_type ?? "",
      valeur:
        ligne.remise_valeur === null
          ? ""
          : ligne.remise_type === "montant"
            ? montantVersSaisie(ligne.remise_valeur, devise)
            : String(ligne.remise_valeur).replace(".", ","),
    },
  });
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampLigne>();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerLigne(s, devise, tauxAutorises, langue),
      (c) =>
        api.patch(
          `/api/factures/${encodeURIComponent(factureId)}/lignes/${encodeURIComponent(ligne.id)}`,
          c,
        ),
      { apres: onEnregistre, messageSpecifique: (e) => messageFacture(e, langue) },
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t(`Modifier la ligne ${ligne.libelle}`, `Edit line ${ligne.libelle}`)}
    >
      <p className="mp-sous-formulaire__titre">
        {t(`Modifier la ligne « ${ligne.libelle} »`, `Edit line "${ligne.libelle}"`)}
      </p>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Désignation", "Description")}
          required
          maxLength={300}
          value={s.libelle}
          onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
          erreur={f.erreurs.libelle}
        />
        <Select
          libelle={t("Taux de TVA", "VAT rate")}
          options={tauxAutorises.map((taux) => ({
            valeur: String(taux),
            libelle: pct(taux, langue),
          }))}
          value={s.taux_tva}
          onChange={(e) => setS((x) => ({ ...x, taux_tva: e.target.value }))}
          erreur={f.erreurs.taux_tva}
        />
        <ChampsRemise
          saisie={s.remise}
          devise={devise}
          erreur={f.erreurs.remise}
          onChange={(remise) => setS((x) => ({ ...x, remise }))}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
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

/** Type et valeur d'une remise (aucune, pourcentage ou montant). */
export function ChampsRemise({
  saisie,
  devise,
  erreur,
  onChange,
  libelle,
}: {
  saisie: SaisieLigne["remise"];
  devise: Devise;
  erreur?: string;
  onChange: (r: SaisieLigne["remise"]) => void;
  libelle?: string;
}) {
  const t = useT();
  const libelleChamp = libelle ?? t("Remise", "Discount");
  return (
    <>
      <Select
        libelle={libelleChamp}
        options={[
          { valeur: "", libelle: t("Aucune", "None") },
          { valeur: "pourcentage", libelle: t("En pourcentage", "As a percentage") },
          {
            valeur: "montant",
            libelle: t(
              `En montant (${libelleDevise(devise)})`,
              `As an amount (${libelleDevise(devise)})`,
            ),
          },
        ]}
        value={saisie.type}
        onChange={(e) => {
          const choix = e.target.value;
          onChange({
            type: choix === "pourcentage" || choix === "montant" ? choix : "",
            valeur: choix ? saisie.valeur : "",
          });
        }}
      />
      {saisie.type ? (
        <Champ
          libelle={
            saisie.type === "pourcentage"
              ? `${libelleChamp} (%)`
              : `${libelleChamp} (${libelleDevise(devise)})`
          }
          required
          inputMode="decimal"
          value={saisie.valeur}
          onChange={(e) => onChange({ ...saisie, valeur: e.target.value })}
          erreur={erreur}
        />
      ) : null}
    </>
  );
}

/** Totaux calculés par le serveur (moteur) : aucune opération sur un montant ici. */
export function TotauxFacture({ facture: f }: { facture: FactureDetaillee }) {
  const t = useT();
  const langue = useLangue();
  const m = (v: number) => formaterMontantMineur(v, f.devise, langue);
  return (
    <dl className="mp-totaux-facture">
      <div>
        <dt>{t("Total brut HT", "Gross total excl. VAT")}</dt>
        <dd>{m(f.total_brut)}</dd>
      </div>
      {f.total_remises !== 0 ? (
        <div>
          <dt>
            {t("Remises", "Discounts")}
            {f.remise_globale_type
              ? t(
                  ` (dont globale : ${libelleRemise(f.remise_globale_type, f.remise_globale_valeur, f.devise, langue)})`,
                  ` (including overall: ${libelleRemise(f.remise_globale_type, f.remise_globale_valeur, f.devise, langue)})`,
                )
              : ""}
          </dt>
          <dd>{m(f.total_remises)}</dd>
        </div>
      ) : null}
      <div>
        <dt>{t("Total HT", "Total excl. VAT")}</dt>
        <dd>{m(f.total_ht)}</dd>
      </div>
      {(f.tva ?? []).map((v) => (
        <div key={v.taux}>
          <dt>
            {t(
              `TVA ${pct(v.taux, langue)} sur ${m(v.base)}`,
              `VAT ${pct(v.taux, langue)} on ${m(v.base)}`,
            )}
          </dt>
          <dd>{m(v.montant)}</dd>
        </div>
      ))}
      <div>
        <dt>{t("Total TVA", "Total VAT")}</dt>
        <dd>{m(f.total_tva)}</dd>
      </div>
      <div className="mp-totaux-facture__fort">
        <dt>{t("Total TTC", "Total incl. VAT")}</dt>
        <dd>{m(f.total_ttc)}</dd>
      </div>
      {(f.retenues ?? []).map((r) => (
        <div key={r.libelle}>
          <dt>
            {t(
              `${r.libelle} (${pct(r.taux, langue)} sur ${r.base} : ${m(r.assiette)})`,
              `${r.libelle} (${pct(r.taux, langue)} on ${r.base === "HT" ? "excl. VAT" : "incl. VAT"}: ${m(r.assiette)})`,
            )}
          </dt>
          <dd>{m(r.montant)}</dd>
        </div>
      ))}
      <div className="mp-totaux-facture__net">
        <dt>{t("Net à payer", "Net payable")}</dt>
        <dd>{m(f.net_a_payer)}</dd>
      </div>
    </dl>
  );
}
